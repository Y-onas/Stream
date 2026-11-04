const kinds=new Set(['VIP_DENIED','VIP_STREAM_LIMIT','CAPACITY_REJECTED','SESSION_REQUEST_LIMIT','RESOURCE_PRESSURE','INVALID_GRANT','EXPIRED_GRANT','EXPIRED_SESSION','CROSS_VIDEO','ACCESS_CHANGED','REVOKED_SESSION','UNTRUSTED_ORIGIN','UPSTREAM_FAILURE','TELEGRAM_FAILURE','SESSION_TERMINATED']);
export function createSecurityEvents(db,now=()=>new Date()){
 const pending=new Map();let busy=false,closed=false;
 function record(kind){if(!kinds.has(kind)||closed)return;pending.set(kind,Math.min(1000,(pending.get(kind)||0)+1));}
 async function flush(){if(busy||closed||!pending.size)return;busy=true;const batch=[...pending];pending.clear();try{
  const at=now(),bucket=Math.floor(+at/60000);
  for(const [kind,count]of batch)await db.securityEvent.upsert({where:{key:`${bucket}:${kind}`},create:{key:`${bucket}:${kind}`,kind,count,firstSeenAt:at,lastSeenAt:at},update:{count:{increment:count},lastSeenAt:at}});
 }catch{/* Best effort, bounded and no secret-bearing fallback logs. */}finally{busy=false;}}
 const timer=setInterval(()=>void flush(),10000);timer.unref();
 return {record,flush,close(){closed=true;clearInterval(timer);pending.clear();}};
}
