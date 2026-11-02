import {HttpError,cookies,hash,isUUID} from './domain.mjs';
import {createPlaybackGrants} from './playback-grants.mjs';

export function createPlayback({db,config,production,actor,viewer,settings,now}){
  const grants=createPlaybackGrants(config,now);
  const denied=()=>new HttpError(403,'An active VIP membership is required to watch this video.','MEMBERSHIP_REQUIRED');
  const until=(...dates)=>new Date(Math.min(...dates.map(Number)));
  async function policy(video,accountSessionId){
    if((await settings.get()).maintenanceMode)throw new HttpError(503,'Playback is temporarily unavailable.','MAINTENANCE');
    if(!video||!video.published||!video.available||video.adminUnavailable)throw new HttpError(404,'Video is not available.');
    if(video.accessType==='FREE')return {deadline:new Date(+now()+grants.ttl*1000),session:null};
    if(video.accessType!=='VIP')throw denied();
    const session=accountSessionId?await db.userSession.findUnique({where:{id:accountSessionId},include:{user:true}}):null;
    if(!session||session.expiresAt<=now()||session.user.status!=='ACTIVE')throw denied();
    const member=await db.membership.findFirst({where:{userId:session.userId,revokedAt:null,expiresAt:{gt:now()}},orderBy:{expiresAt:'desc'}});
    if(!member)throw denied();
    return{deadline:until(member.expiresAt,session.expiresAt,new Date(+now()+grants.ttl*1000)),session};
  }
  async function state(claims){
    const play=await db.playbackSession.findUnique({where:{id:claims.sid},include:{video:true,viewer:true}});
    if(!play||play.revokedAt||play.expiresAt<=now()||!play.authorizedUntil||play.authorizedUntil<=now()||play.viewer.expiresAt<=now())throw new HttpError(401,'Playback session expired. Start playback again.','PLAYBACK_SESSION_EXPIRED');
    if(play.video.publicId!==claims.vid||play.viewerId!==claims.ctx||play.accessType!==claims.mode||play.video.accessType!==claims.mode||claims.sub!==(play.accessType==='VIP'?play.userId:`anonymous:${play.viewerId}`))throw new HttpError(403,'Playback access changed. Start playback again.','PLAYBACK_ACCESS_CHANGED');
    const access=await policy(play.video,play.accountSessionId);
    return{play,access,leaseUntil:+until(play.authorizedUntil,play.expiresAt,play.viewer.expiresAt,access.deadline)};
  }
  function grantCookie(res,id,value,deadline){const existing=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:[existing]),`hh_playback=${value}; Path=/api/playback/${id}/stream; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((deadline-now())/1000))}${production?'; Secure':''}`]);}
  async function issue(res,play,video,owner,access){
    const deadline=new Date(Math.floor(+until(access.deadline,play.expiresAt,owner.expiresAt)/1000)*1000),claims={purpose:'playback',vid:video.publicId,sid:play.id,ctx:owner.id,mode:video.accessType,sub:video.accessType==='VIP'?play.userId:`anonymous:${owner.id}`};
    const value=await grants.sign(claims,deadline);
    await db.playbackSession.update({where:{id:play.id},data:{authorizedUntil:deadline}});
    grantCookie(res,play.id,value,deadline);
    return{id:play.id,streamUrl:`/api/playback/${play.id}/stream`,expiresAt:deadline.toISOString(),accessType:video.accessType};
  }
  async function authorize(req,res,id,position=0){
    if(!isUUID(id)||!Number.isFinite(position)||position<0||position>7*86400)throw new HttpError(400,'Select a valid video and playback position.');
    if(!grants.configured)throw new HttpError(503,'Playback authorization is not configured.');
    const video=await db.video.findUnique({where:{publicId:id}});
    if(!video||!video.published||!video.available||video.adminUnavailable)throw new HttpError(404,'Video is not available.');
    const session=await actor(req,res,{required:video?.accessType==='VIP',csrf:video?.accessType==='VIP'}),access=await policy(video,session?.id),owner=await viewer(req,res,{create:true});
    const play=await db.playbackSession.create({data:{videoId:video.id,viewerId:owner.id,userId:session?.userId,accountSessionId:video.accessType==='VIP'?session.id:null,accessType:video.accessType,lastHeartbeatAt:now(),lastPosition:position,expiresAt:new Date(+now()+4*3600000)}});
    return issue(res,play,video,owner,access);
  }
  async function owned(req,res,id){
    if(!isUUID(id))throw new HttpError(400,'Invalid playback session.');
    const owner=await viewer(req,res),play=await db.playbackSession.findUnique({where:{id},include:{video:true}});
    if(!play||play.viewerId!==owner.id||play.revokedAt||play.expiresAt<=now())throw new HttpError(404,'Playback session not found.');
    if(play.accessType==='VIP'){const session=await actor(req,res,{required:true,csrf:true});if(session.id!==play.accountSessionId)throw denied();}
    return {play,owner};
  }
  return{grants,policy,state,
    authorize,
    async renew(req,res,id){const {play,owner}=await owned(req,res,id);if(play.accessType!==play.video.accessType)throw denied();return issue(res,play,play.video,owner,await policy(play.video,play.accountSessionId));},
    async terminate(req,res,id){const {play}=await owned(req,res,id);await db.playbackSession.update({where:{id:play.id},data:{revokedAt:now(),authorizedUntil:now()}});grantCookie(res,id,'',now());return {terminated:true};},
    async stream(req,res,id){const value=cookies(req).hh_playback,claims=await grants.verify(value);if(claims.purpose!=='playback'||claims.sid!==id)throw new HttpError(403,'Invalid playback session.');const current=await state(claims);if(current.play.viewer.tokenHash!==hash(cookies(req).hh_viewer||''))throw new HttpError(403,'Playback session does not belong to this browser.');if(claims.mode==='VIP'&&current.access.session.tokenHash!==hash(cookies(req).hh_session||''))throw denied();return {grant:value,videoId:claims.vid};},
    async introspect(value,active=false){const claims=await grants.verify(value,{active});if(claims.purpose==='probe'){if(active)throw new HttpError(403,'Worker grants cannot be renewed.');const video=await db.video.findUnique({where:{publicId:claims.vid}});if(!video?.available)throw new HttpError(404,'Media unavailable.');return{key:video.id,videoId:video.publicId,leaseUntil:claims.exp*1000};}const current=await state(claims);return{key:current.play.video.id,videoId:claims.vid,leaseUntil:current.leaseUntil};},
    async internalGrant(video){if(!video.publicId)throw new HttpError(503,'Media authorization is unavailable.');return grants.sign({purpose:'probe',vid:video.publicId,mode:'INTERNAL',sub:'media-worker'},new Date(+now()+Math.min(120,grants.ttl)*1000));}
  };
}
