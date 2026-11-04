import {HttpError,cookies,hash,isUUID} from './domain.mjs';
import {createPlaybackGrants} from './playback-grants.mjs';
import {createPlaybackCapacity,clientLabel,lifecycleUpdate} from './playback-capacity.mjs';
import {randomUUID} from 'node:crypto';
import {Prisma} from './database.mjs';

export function createPlayback({db,config,production,actor,viewer,settings,now,limit}){
  if(typeof limit!=='function')throw Error('Playback request limiter is required.');
  const grants=createPlaybackGrants(config,now);
  const capacity=createPlaybackCapacity({db,config,production,now});
  const table=name=>Prisma.raw(`"${db.appSchema||'public'}"."${name}"`);
  const denied=()=>new HttpError(403,'An active VIP membership is required to watch this video.','MEMBERSHIP_REQUIRED');
  const until=(...dates)=>new Date(Math.min(...dates.map(Number)));
  async function load(database,id,lock=false){
    // One consistent snapshot replaces separate relation/user/membership reads
    // on every stream lease check. Lock only the playback row for heartbeats.
    const [row]=await database.$queryRaw`SELECT p.*,
      json_build_object('id',v.id,'publicId',v."publicId",'accessType',v."accessType",'published',v.published,'available',v.available,'adminUnavailable',v."adminUnavailable",'durationSeconds',v."durationSeconds",'sourceRetryAt',v."sourceRetryAt") AS video,
      json_build_object('id',w.id,'tokenHash',w."tokenHash",'expiresAt',w."expiresAt") AS viewer,
      CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id',s.id,'userId',s."userId",'tokenHash',s."tokenHash",'expiresAt',s."expiresAt",'user',json_build_object('id',u.id,'status',u.status)) END AS account,
      m."expiresAt" AS "membershipDeadline"
      FROM ${table('hh_playback_sessions')} p JOIN ${table('hh_videos')} v ON v.id=p."videoId"
      JOIN ${table('hh_viewer_sessions')} w ON w.id=p."viewerId"
      LEFT JOIN ${table('hh_user_sessions')} s ON s.id=p."accountSessionId" LEFT JOIN ${table('hh_users')} u ON u.id=s."userId"
      LEFT JOIN LATERAL (SELECT "expiresAt" FROM ${table('hh_memberships')} WHERE "userId"=s."userId" AND "revokedAt" IS NULL AND "expiresAt">${now()} ORDER BY "expiresAt" DESC LIMIT 1) m ON true
      WHERE p.id=${id}::uuid ${Prisma.raw(lock?'FOR UPDATE OF p':'')}`;
    if(!row)return null;
    row.viewer.expiresAt=new Date(row.viewer.expiresAt);if(row.video.sourceRetryAt)row.video.sourceRetryAt=new Date(row.video.sourceRetryAt);if(row.account)row.account.expiresAt=new Date(row.account.expiresAt);
    return row;
  }
  async function policy(video,accountSessionId,database=db,platform,identity){
    if((platform||await settings.get()).maintenanceMode)throw new HttpError(503,'Playback is temporarily unavailable.','MAINTENANCE');
    if(!video||!video.published||!video.available||video.adminUnavailable)throw new HttpError(404,'Video is not available.');
    if(video.sourceRetryAt&&video.sourceRetryAt>now())throw new HttpError(503,'The video source is temporarily unavailable. Please try again shortly.','SOURCE_TEMPORARY');
    if(video.accessType==='FREE')return {deadline:new Date(+now()+grants.ttl*1000),session:null};
    if(video.accessType!=='VIP')throw denied();
    const session=identity?identity.account:accountSessionId?await database.userSession.findUnique({where:{id:accountSessionId},include:{user:true}}):null;
    if(!session||session.expiresAt<=now()||session.user.status!=='ACTIVE')throw denied();
    const member=identity?(identity.membershipDeadline?{expiresAt:identity.membershipDeadline}:null):await database.membership.findFirst({where:{userId:session.userId,revokedAt:null,expiresAt:{gt:now()}},orderBy:{expiresAt:'desc'}});
    if(!member)throw denied();
    return{deadline:until(member.expiresAt,session.expiresAt,new Date(+now()+grants.ttl*1000)),session};
  }
  async function invalidate(play){
    const at=now();
    // Do not let a stale failure overwrite a later successful authorization.
    // Active data leases remain tracked until Go cancels/releases them; a
    // playback termination must not hide an open upstream request.
    return db.playbackSession.updateMany({where:{id:play.id,viewerId:play.viewerId,revokedAt:null,authorizedUntil:play.authorizedUntil},data:{state:'TERMINATED',revokedAt:at,authorizedUntil:at,reservedUntil:at}});
  }
  async function checkedPolicy(play,identity){
    try{
      if(play.accessType!==play.video.accessType)throw new HttpError(403,'Playback access changed. Start playback again.','PLAYBACK_ACCESS_CHANGED');
      return await policy(play.video,play.accountSessionId,db,undefined,identity);
    }catch(error){
      // Call only after validating session ownership or signed-claim binding.
      // Bad cookies/CSRF cannot kill somebody else's session. Source failures,
      // maintenance and database outages must not revoke a recoverable session.
      if([403,404].includes(error.status))await invalidate(play);
      throw error;
    }
  }
  async function state(claims){
    const play=await load(db,claims.sid);
    if(play?.revokedAt)throw new HttpError(401,'Playback session was terminated.','PLAYBACK_SESSION_REVOKED');
    if(!play||play.revokedAt||["EXPIRED","TERMINATED"].includes(play.state)||play.expiresAt<=now()||!play.reservedUntil||play.reservedUntil<=now()||!play.authorizedUntil||play.authorizedUntil<=now()||play.viewer.expiresAt<=now())throw new HttpError(401,'Playback session expired. Start playback again.','PLAYBACK_SESSION_EXPIRED');
    if(play.video.publicId!==claims.vid||play.viewerId!==claims.ctx||play.accessType!==claims.mode||claims.sub!==(play.accessType==='VIP'?play.userId:`anonymous:${play.viewerId}`))throw new HttpError(403,'Playback access changed. Start playback again.','PLAYBACK_ACCESS_CHANGED');
    const access=await checkedPolicy(play,play);
    return{play,access,leaseUntil:+until(play.authorizedUntil,play.reservedUntil,play.expiresAt,play.viewer.expiresAt,access.deadline)};
  }
  function grantCookie(res,id,value,deadline){const existing=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:[existing]),`hh_playback=${value}; Path=/api/playback/${id}/stream; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((deadline-now())/1000))}${production?'; Secure':''}`]);}
  async function issue(res,play,video,owner,access){
    const deadline=new Date(Math.floor(+until(access.deadline,play.expiresAt,owner.expiresAt)/1000)*1000),claims={purpose:'playback',vid:video.publicId,sid:play.id,ctx:owner.id,mode:video.accessType,sub:video.accessType==='VIP'?play.userId:`anonymous:${owner.id}`};
    let value;try{value=await grants.sign(claims,deadline);}catch(error){if(error.code==='ACCESS_EXPIRED'){await invalidate(play);grantCookie(res,play.id,'',now());}throw error;}
    const at=now();
    // Recheck current access in the write itself. A termination, logout,
    // membership expiry or classification change during signing cannot issue
    // a renewed authorization from the earlier policy snapshot.
    const changed=await db.$executeRaw`UPDATE ${table('hh_playback_sessions')} p SET "authorizedUntil"=${deadline}
      WHERE p.id=${play.id}::uuid AND p."viewerId"=${owner.id}::uuid AND p."revokedAt" IS NULL
      AND p.state NOT IN ('EXPIRED','TERMINATED') AND p."reservedUntil">${at} AND p."expiresAt">=${deadline} AND ${deadline}>${at}
      AND p."accessType"=${video.accessType} AND p."accountSessionId" IS NOT DISTINCT FROM ${play.accountSessionId}::uuid
      AND EXISTS(SELECT 1 FROM ${table('hh_videos')} v WHERE v.id=p."videoId" AND v."publicId"=${video.publicId}::uuid AND v.published AND v.available AND NOT v."adminUnavailable" AND v."accessType"=p."accessType")
      AND EXISTS(SELECT 1 FROM ${table('hh_viewer_sessions')} w WHERE w.id=p."viewerId" AND w."expiresAt">=${deadline})
      AND (p."accessType"='FREE' OR EXISTS(SELECT 1 FROM ${table('hh_user_sessions')} s JOIN ${table('hh_users')} u ON u.id=s."userId" JOIN ${table('hh_memberships')} m ON m."userId"=u.id
        WHERE s.id=p."accountSessionId" AND s."userId"=p."userId" AND s."expiresAt">=${deadline} AND u.status='ACTIVE' AND m."revokedAt" IS NULL AND m."expiresAt">=${deadline}))`;
    if(!changed||deadline<=now()){await invalidate(changed?{...play,authorizedUntil:deadline}:play);grantCookie(res,play.id,'',now());throw new HttpError(410,'Playback access changed or the session expired. Start playback again.','PLAYBACK_SESSION_EXPIRED');}
    grantCookie(res,play.id,value,deadline);
    return{id:play.id,streamUrl:`/api/playback/${play.id}/stream`,expiresAt:deadline.toISOString(),accessType:video.accessType,position:play.lastPosition,sequence:play.sequence,state:play.state,recoveryUntil:play.reservedUntil};
  }
  async function authorize(req,res,id,position=0,{requestId,sessionId}={}){
    if(!isUUID(id)||!Number.isFinite(position)||position<0||position>7*86400)throw new HttpError(400,'Select a valid video and playback position.');
    if(!sessionId&&config.playbackDrain)throw new HttpError(503,'New playback is temporarily paused. Please try again shortly.','PLAYBACK_DRAINING');
    if((requestId!==undefined&&!isUUID(requestId))||(sessionId!==undefined&&!isUUID(sessionId)))throw new HttpError(400,'Invalid playback request identity.');
    if(!grants.configured)throw new HttpError(503,'Playback authorization is not configured.');
    if(sessionId){
      const {play,owner}=await owned(req,res,sessionId);
      if(play.video.publicId!==id)throw new HttpError(409,'Playback request belongs to another video.','PLAYBACK_GRANT_SCOPE');
      try{return await issue(res,play,play.video,owner,await checkedPolicy(play));}catch(error){if([403,404,410].includes(error.status))grantCookie(res,play.id,'',now());throw error;}
    }
    const video=await db.video.findUnique({where:{publicId:id}});
    if(!video||!video.published||!video.available||video.adminUnavailable)throw new HttpError(404,'Video is not available.');
    let session;try{session=await actor(req,res,{required:video?.accessType==='VIP',csrf:true});}catch(error){if(error.status===401&&video.accessType==='VIP')error.code='MEMBERSHIP_REQUIRED';throw error;}
    const access=await policy(video,session?.id),owner=await viewer(req,res,{create:true});
    const play=await db.$transaction(tx=>capacity.reserve(tx,{videoId:video.id,viewerId:owner.id,userId:session?.userId||null,accountSessionId:session?.id||null,requestKey:requestId||null,clientLabel:clientLabel(req.headers['user-agent']),accessType:video.accessType,lastHeartbeatAt:now(),lastPosition:position,expiresAt:new Date(+now()+4*3600000)}),{timeout:15000});
    return issue(res,play,video,owner,access);
  }
  async function owned(req,res,id){
    if(!isUUID(id))throw new HttpError(400,'Invalid playback session.');
    const owner=await viewer(req,res),play=await db.playbackSession.findUnique({where:{id},include:{video:true}});
    if(!play||play.viewerId!==owner.id||play.revokedAt||["EXPIRED","TERMINATED"].includes(play.state)||play.expiresAt<=now()||!play.reservedUntil||play.reservedUntil<=now())throw new HttpError(410,'Playback session expired. Start playback again.','PLAYBACK_SESSION_EXPIRED');
    if(play.accountSessionId){const session=await actor(req,res,{required:true,csrf:true,onInvalidSession:async stale=>{if(stale.id===play.accountSessionId)await invalidate(play);}});if(session.id!==play.accountSessionId)throw denied();}
    return {play,owner};
  }
  return{grants,policy,state,load,capacity,invalidate,metadataLease:()=>capacity.metadata(randomUUID()),
    authorize,
    async renew(req,res,id){const {play,owner}=await owned(req,res,id);try{return await issue(res,play,play.video,owner,await checkedPolicy(play));}catch(error){if([403,404,410].includes(error.status))grantCookie(res,id,'',now());throw error;}},
    async disconnect(req,res,id){const {play}=await owned(req,res,id);if(['PAUSED','DISCONNECTED'].includes(play.state))return {disconnected:true};await db.playbackSession.updateMany({where:{id:play.id,state:{not:'PAUSED'},lastHeartbeatAt:play.lastHeartbeatAt,revokedAt:null,reservedUntil:{gt:now()}},data:lifecycleUpdate(play,'DISCONNECTED',now())});return {disconnected:true};},
    async terminate(req,res,id){const {play}=await owned(req,res,id);await db.playbackSession.update({where:{id:play.id},data:{state:'TERMINATED',revokedAt:now(),authorizedUntil:now(),reservedUntil:now()}});grantCookie(res,id,'',now());return {terminated:true};},
    async stream(req,res,id){
      const reject=error=>{limit(req,'media-invalid',180,60000);throw error;};
      const value=cookies(req).hh_playback;let claims;
      try{claims=await grants.verify(value);}catch(error){if([401,403].includes(error.status))return reject(error);throw error;}
      if(claims.purpose!=='playback'||claims.sid!==id)return reject(new HttpError(403,'Invalid playback session.','PLAYBACK_GRANT_SCOPE'));
      const current=await state(claims);
      if(current.play.viewer.tokenHash!==hash(cookies(req).hh_viewer||''))return reject(new HttpError(403,'Playback session does not belong to this browser.','PLAYBACK_GRANT_SCOPE'));
      if(claims.mode==='VIP'&&current.access.session.tokenHash!==hash(cookies(req).hh_session||''))return reject(denied());
      // Charge only a verified, browser-bound session. Invalid traffic behind
      // the same proxy cannot spend this allowance; rotating IPs cannot evade it.
      limit(req,'media',180,60000,`playback:${id}`);
      return {grant:value,videoId:claims.vid};
    },
    async introspect(value,active=false,reservationId){
      const claims=await grants.verify(value,{active});let result;
      if(claims.purpose==='probe'){if(active)throw new HttpError(403,'Worker grants cannot be renewed.');const video=await db.video.findUnique({where:{publicId:claims.vid}});if(!video?.available)throw new HttpError(404,'Media unavailable.');if(video.sourceRetryAt&&video.sourceRetryAt>now())throw new HttpError(503,'Media source is temporarily unavailable.');result={key:video.id,videoId:video.publicId,leaseUntil:claims.exp*1000};}
      else{const current=await state(claims);result={key:current.play.video.id,videoId:claims.vid,leaseUntil:current.leaseUntil};}
      if(!reservationId)throw new HttpError(400,'Upstream reservation is required.');
      await capacity.upstream(claims,reservationId,result.leaseUntil,active);return result;
    },
    async internalGrant(video){if(!video.publicId)throw new HttpError(503,'Media authorization is unavailable.');return grants.sign({purpose:'probe',vid:video.publicId,mode:'INTERNAL',sub:'media-worker'},new Date(+now()+Math.min(120,grants.ttl)*1000));}
  };
}
