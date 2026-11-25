// Coalesce repeated toolbar taps without issuing a Range request for each tap.
export function createSeekQueue({position,duration,apply,schedule=setTimeout,cancel=clearTimeout}){
 let target=null,timer;
 const to=value=>{const length=duration();if(!Number.isFinite(value)||!Number.isFinite(length)||length<=0)return;target=Math.min(Math.max(0,length-.05),Math.max(0,value));cancel(timer);timer=schedule(()=>{const next=target;target=null;timer=undefined;apply(next);},250);return target;};
 return {
  by(seconds){const base=target??position();if(!Number.isFinite(base)||!Number.isFinite(seconds))return;return to(base+seconds);},
  to,
  target:()=>target,
  clear(){cancel(timer);timer=undefined;target=null;}
 };
}

export function createVideoTransport({element,source,duration,onWaiting,onError,revalidate,fetcher=fetch,schedule=setTimeout,cancel=clearTimeout,now=Date.now}){
 let disposed=false,recovering=false,reloading=false,timer,probe,attempts=0,started=0,target=null,lastPosition=element.currentTime||0,lastDuration=element.duration,wasPlaying=!element.paused,restorePlaying=false,lastSeek=0;
 const queue=createSeekQueue({position:()=>target??(Number.isFinite(element.currentTime)?element.currentTime:lastPosition),duration:()=>Number.isFinite(element.duration)?element.duration:lastDuration||duration,apply:next=>{
  lastSeek=now();target=next;lastPosition=next;onWaiting(true);
  if(!recovering&&element.readyState>0)element.currentTime=next;
 },schedule,cancel});
 const fail=message=>{recovering=false;reloading=false;onWaiting(false);onError(message);};
 const retry=delay=>{
  if(disposed)return;
  if(++attempts>6||now()-started>45000){fail('The connection could not recover. Check your connection and try again.');return;}
  timer=schedule(()=>{if(disposed)return;recovering=false;reloading=true;element.src=source;element.load();},Math.max(delay,Math.min(4000,500*2**(attempts-1))));
 };
 async function error(){
  if(disposed||recovering)return;
  recovering=true;if(!started)started=now();
  const mediaCode=element.error?.code;
  target=queue.target()??target??(Number.isFinite(element.currentTime)&&element.currentTime>0?element.currentTime:lastPosition);
  restorePlaying=wasPlaying;onError('');onWaiting(true);
  // Stop the failed/canceled body before probing/reloading so it can release its
  // upstream lease. Keep the same playback session, progress and signed URL.
  element.removeAttribute('src');element.load();
  probe=new AbortController();
  try{
   const response=await fetcher(source,{method:'HEAD',cache:'no-store',signal:AbortSignal.any([probe.signal,AbortSignal.timeout(15000)])});
   if(disposed)return;
   if([401,403,410].includes(response.status)){
    if(await revalidate?.()){if(!disposed)retry(500);return;}
    if(!disposed)fail('Playback access could not be renewed. Start playback again.');return;
   }
   if(response.status===404){fail('This video is no longer available.');return;}
   if([429,500,502,503,504].includes(response.status)){
    const after=response.headers.get('retry-after');const seconds=Number(after);const delay=after?(Number.isFinite(seconds)?seconds*1000:Date.parse(after)-now()):0;retry(Number.isFinite(delay)?Math.max(0,delay):0);return;
   }
   if(!response.ok){fail('Playback could not be resumed. Please try again.');return;}
   if([3,4].includes(mediaCode)&&attempts>0&&!lastSeek){fail(mediaCode===4?'This browser cannot play this video’s container or codec.':'This browser could not decode this video.');return;}
   retry(500);
  }catch(error){if(!disposed&&error.name!=='AbortError')retry(1000);}
 }
 function metadata(){
  lastDuration=element.duration;
  if(target!==null&&Number.isFinite(element.duration)){element.currentTime=Math.min(Math.max(0,element.duration-.05),target);lastPosition=element.currentTime;target=null;}
 }
 function canPlay(){
  if(disposed)return;recovering=false;reloading=false;onWaiting(false);
  if(restorePlaying){restorePlaying=false;void element.play().catch(()=>{});}
 }
 const playing=()=>{wasPlaying=true;canPlay();},pause=()=>{if(!element.error&&!recovering&&!reloading)wasPlaying=false;};
 const seeked=()=>{if(!recovering){target=null;if(Number.isFinite(element.currentTime))lastPosition=element.currentTime;}};
 const time=()=>{if(Number.isFinite(element.currentTime)&&element.readyState>0){lastPosition=element.currentTime;if(!element.seeking&&!element.error&&element.readyState>=3&&now()-lastSeek>3000){attempts=0;started=0;lastSeek=0;}}};
 // play fires when playback is requested, before the first frame is available.
 // Preserve that intent across an initial network failure, not just failures
 // after playing has fired. A real user pause still clears it above.
 const playIntent=()=>{wasPlaying=true;};
 element.addEventListener('play',playIntent);element.addEventListener('pause',pause);element.addEventListener('timeupdate',time);
 return {seekBy:queue.by,seekTo:queue.to,error,metadata,canPlay,playing,seeked,
  startAt(position){
   if(disposed||!Number.isFinite(position)||position<0)return;
   // Keep the user gesture synchronous even if metadata has not arrived yet.
   // metadata() applies the requested resume position once duration is known.
   queue.clear();target=position;lastPosition=position;
   if(element.readyState>0)metadata();
   return element.play();
  },
  retry(){attempts=0;started=0;void error();},
  close(){disposed=true;cancel(timer);queue.clear();probe?.abort();element.removeEventListener('play',playIntent);element.removeEventListener('pause',pause);element.removeEventListener('timeupdate',time);}
 };
}
