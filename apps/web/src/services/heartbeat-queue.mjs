// Retain one immutable unacknowledged report and one coalesced latest report.
// A lost acknowledgement retries the exact sequence/payload for server dedupe.
export function createHeartbeatQueue(sequence=0){
 let pending=null,unacknowledged=null,work=null,callbacks={};
 async function drain(){
  if(work)return work;
  if(!unacknowledged&&pending){unacknowledged={...pending,sequence:sequence+1};pending=null;}
  if(!unacknowledged)return;
  const report=unacknowledged;
  work=(async()=>{
   let accepted=false;
   try{const result=await Promise.resolve().then(()=>callbacks.send(report));sequence=report.sequence;unacknowledged=null;accepted=true;callbacks.acknowledged?.(result);}
   catch(error){callbacks.failed?.(error);}
   finally{work=null;if(accepted&&pending)void drain();}
  })();
  return work;
 }
 return {
  configure(next){callbacks=next;},
  report(data){
   const playedSeconds=Math.min(45,(pending?.playedSeconds||0)+data.playedSeconds);
   pending={...data,playing:playedSeconds>0,playedSeconds};
   return drain();
  }
 };
}
