import {randomUUID} from 'node:crypto';
import {Prisma} from './database.mjs';
import {HttpError,isUUID} from './domain.mjs';

export const activePlayback=at=>({revokedAt:null,state:{notIn:['EXPIRED','TERMINATED']},reservedUntil:{gt:at},expiresAt:{gt:at}});
export function lifecycleUpdate(play,state,at){
 if(!['PLAYING','PAUSED','BUFFERING','DISCONNECTED'].includes(state))throw new HttpError(400,'Invalid playback state.');
 const pauseStartedAt=state==='PAUSED'?(play.state==='PAUSED'&&play.pauseStartedAt?play.pauseStartedAt:at):null;
 return {state,pauseStartedAt,reservedUntil:new Date(Math.min(+play.expiresAt,+(pauseStartedAt||at)+(state==='PAUSED'?600000:90000)))};
}
export function clientLabel(agent=''){
 // Coarse browser/OS labels only; no IP address, fingerprint or full user agent.
 const browser=/Edg\//.test(agent)?'Edge':/Chrome\//.test(agent)?'Chrome':/Firefox\//.test(agent)?'Firefox':/Safari\//.test(agent)?'Safari':'Browser';
 const os=/Android/.test(agent)?'Android':/iPhone|iPad/.test(agent)?'iOS':/Windows/.test(agent)?'Windows':/Macintosh/.test(agent)?'macOS':/Linux/.test(agent)?'Linux':'Unknown OS';
 return `${browser} / ${os}`;
}

export function createPlaybackCapacity({db,config,production,now}){
 const table=name=>Prisma.raw(`"${db.appSchema||'public'}"."${name}"`);
 const sessionLimit=config.sessionUpstreamLimit??2;
 if(![1,2].includes(sessionLimit))throw Error('Per-session upstream limit must be 1 or 2.');
 const workBusy=()=>new HttpError(503,'A background media task is already running. Please retry shortly.','BACKGROUND_BUSY');
 async function clock(tx,scope){
  // Serialize only the same account, playback or background worker. There is
  // deliberately no platform-wide admission lock or global reservation count.
  if(!scope){if(!production)return now();const [row]=await tx.$queryRaw`SELECT clock_timestamp() AS at`;return row.at;}
  const [clock]=await tx.$queryRaw`WITH setup AS MATERIALIZED (SELECT set_config('lock_timeout','3s',true)),gate AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext(${`${db.appSchema||'public'}:${scope}`}))::text FROM setup) SELECT clock_timestamp() AS at FROM gate`;
  return production?clock.at:now();
 }
 async function reserve(tx,data){
  if(data.accessType==='VIP'&&!isUUID(data.userId))throw new HttpError(400,'VIP playback requires an account.');
  const at=await clock(tx,data.accessType==='VIP'?`vip-playback:${data.userId}`:null);
  const [created]=await tx.$queryRaw`WITH totals AS (
    SELECT count(*) AS vip FROM ${table('hh_playback_sessions')}
    WHERE ${data.accessType}='VIP' AND "userId"=${data.userId}::uuid AND "accessType"='VIP'
      AND "revokedAt" IS NULL AND state NOT IN ('EXPIRED','TERMINATED') AND "reservedUntil">${at} AND "expiresAt">${at}
   ),inserted AS (
    INSERT INTO ${table('hh_playback_sessions')}(id,"videoId","viewerId","userId","accountSessionId","requestKey","clientLabel","accessType","lastHeartbeatAt","lastPosition","expiresAt","reservedUntil",state,"progressUpdatedAt")
    SELECT ${randomUUID()}::uuid,${data.videoId},${data.viewerId}::uuid,${data.userId}::uuid,${data.accountSessionId}::uuid,${data.requestKey}::uuid,${data.clientLabel||null},${data.accessType},${data.lastHeartbeatAt},${data.lastPosition},${data.expiresAt},${new Date(Math.min(+data.expiresAt,+at+90000))},'BUFFERING',${at}
    FROM totals WHERE ${data.accessType} <> 'VIP' OR vip<2
    ON CONFLICT("requestKey") DO NOTHING RETURNING *
   ) SELECT inserted.*,totals.vip AS "capacityVip" FROM totals LEFT JOIN inserted ON true`;
  if(created.id)return created;
  if(data.requestKey){const prior=await tx.playbackSession.findUnique({where:{requestKey:data.requestKey}});if(prior){
   if(prior.videoId!==data.videoId||prior.viewerId!==data.viewerId||prior.accountSessionId!==data.accountSessionId)throw new HttpError(409,'Playback request belongs to another session.');
   if(prior.accessType!==data.accessType)throw new HttpError(409,'Playback access changed. Start a new session.','PLAYBACK_ACCESS_CHANGED');
   if(prior.revokedAt||['EXPIRED','TERMINATED'].includes(prior.state)||!prior.reservedUntil||prior.reservedUntil<=at||prior.expiresAt<=at)throw new HttpError(410,'Start a new playback session.','PLAYBACK_SESSION_EXPIRED');
   return prior;
  }}
  if(data.accessType==='VIP'&&Number(created.capacityVip)>=2)throw new HttpError(429,'Two VIP videos are already active on your account. Pause or close one before starting another.','VIP_STREAM_LIMIT');
  throw new HttpError(409,'Playback request could not be created. Please retry.');
 }
 async function upstream(claims,id,deadline,active=false){
  if(!isUUID(id))throw new HttpError(400,'Invalid upstream reservation.');
  return db.$transaction(async tx=>{
   const contextId=claims.sid||claims.vid,at=await clock(tx,`upstream:${contextId}`);
   if(active){const changed=await tx.upstreamLease.updateMany({where:{id,contextId,expiresAt:{gt:at}},data:{expiresAt:new Date(deadline)}});if(!changed.count)throw new HttpError(403,'Upstream reservation is no longer active.');return {renewed:true};}
   const result=await tx.$queryRaw`WITH cfg AS (SELECT COALESCE((SELECT "sessionUpstreamLimit" FROM ${table('hh_platform_settings')} WHERE id='platform'),${sessionLimit}) AS maximum),
     prior AS (SELECT "contextId","expiresAt" FROM ${table('hh_upstream_leases')} WHERE id=${id}::uuid),
     totals AS (SELECT count(*) AS own FROM ${table('hh_upstream_leases')} WHERE "contextId"=${contextId} AND "expiresAt">${at})
     INSERT INTO ${table('hh_upstream_leases')}(id,"contextId","playbackSessionId","expiresAt")
     SELECT ${id}::uuid,${contextId},${claims.sid||null}::uuid,${new Date(deadline)} FROM cfg,totals
     WHERE totals.own<cfg.maximum OR EXISTS(SELECT 1 FROM prior WHERE "contextId"=${contextId} AND "expiresAt">${at})
     ON CONFLICT(id) DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt" WHERE ${table('hh_upstream_leases')}."contextId"=EXCLUDED."contextId" AND ${table('hh_upstream_leases')}."expiresAt">${at}
     RETURNING id`;
   if(!result.length){
    const prior=await tx.upstreamLease.findUnique({where:{id}});
    if(prior&&(prior.contextId!==contextId||prior.expiresAt<=at))throw new HttpError(403,'Upstream reservation is no longer active.');
    throw new HttpError(503,'This playback already has its permitted parallel media requests. Please retry shortly.','SESSION_UPSTREAM_LIMIT');
   }return {id};
  },{timeout:10000});
 }
 async function cleanup(){
  return db.$transaction(async tx=>{
   const [row]=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${`${db.appSchema||'public'}:hub-cleanup`})) AS locked`;
   if(!row.locked)return {skipped:true};const at=now();
   // Indexed bounded batches, idempotent under multiple instances. Do not
   // delete playback history, analytics, paused slots or recovery windows.
   const expired=await tx.$queryRaw`SELECT id FROM ${table('hh_playback_sessions')} WHERE "revokedAt" IS NULL AND "reservedUntil"<=${at} AND state NOT IN ('EXPIRED','TERMINATED') ORDER BY "reservedUntil" LIMIT 500 FOR UPDATE SKIP LOCKED`;
   const changed=expired.length?await tx.playbackSession.updateMany({where:{id:{in:expired.map(r=>r.id)},reservedUntil:{lte:at}},data:{state:'EXPIRED'}}):{count:0};
   await tx.$executeRaw`DELETE FROM ${table('hh_upstream_leases')} WHERE "expiresAt"<=${at} AND id IN (SELECT id FROM ${table('hh_upstream_leases')} WHERE "expiresAt"<=${at} LIMIT 500)`;
   await tx.$executeRaw`DELETE FROM ${table('hh_security_events')} WHERE "lastSeenAt"<${new Date(+at-7*86400000)} AND key IN (SELECT key FROM ${table('hh_security_events')} WHERE "lastSeenAt"<${new Date(+at-7*86400000)} LIMIT 500)`;
   return {expired:changed.count};
  },{timeout:10000});
 }
 async function discovery(id){
  if(!isUUID(id))throw new HttpError(400,'Invalid upstream reservation.');
  return db.$transaction(async tx=>{
   const at=await clock(tx,'discovery-worker'),expiresAt=new Date(+at+30000);
   if(await tx.upstreamLease.count({where:{kind:'DISCOVERY',expiresAt:{gt:at}}})>=1)throw workBusy();
   await tx.upstreamLease.create({data:{id,contextId:'discovery',kind:'DISCOVERY',expiresAt}});return {leaseUntil:+expiresAt};
  },{timeout:10000});
 }
 async function metadata(id){
  await db.$transaction(async tx=>{const at=await clock(tx,'metadata-worker');if(await tx.upstreamLease.count({where:{kind:'METADATA',expiresAt:{gt:at}}}))throw workBusy();await tx.upstreamLease.create({data:{id,contextId:'metadata',kind:'METADATA',expiresAt:new Date(+at+180000)}});},{timeout:10000});
  return async()=>{await db.upstreamLease.deleteMany({where:{id}});};
 }
 return {reserve,upstream,discovery,metadata,cleanup,active:activePlayback,async release(id){if(!isUUID(id))throw new HttpError(400,'Invalid upstream reservation.');await db.upstreamLease.deleteMany({where:{id}});return {released:true};}};
}
