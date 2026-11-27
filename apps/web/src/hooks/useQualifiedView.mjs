import {useEffect,useRef} from 'react';
import {api} from '../services/api.mjs';
import {useAccount} from './useAccount';
import {createHeartbeatQueue} from '../services/heartbeat-queue.mjs';
export function useQualifiedView(player,video,revision,enabled=true,authorizedSessionId,initialSequence=0,onDenied){
 const account=useAccount(),statistics=useRef(null),denial=useRef(onDenied);denial.current=onDenied;
 useEffect(()=>{
  const el=player.current;if(!el||!video||!enabled||!authorizedSessionId)return;
  if(statistics.current?.id!==authorizedSessionId)statistics.current={id:authorizedSessionId,queue:createHeartbeatQueue(initialSequence)};
  const session=statistics.current;let disposed=false,state='BUFFERING',seeking=false,played=0,previous=el.currentTime,previousTime=performance.now();
  session.queue.configure({send:report=>api(`/playback/${session.id}/heartbeat`,{method:'POST',keepalive:true,signal:AbortSignal.timeout(10000),json:report}),acknowledged:result=>{if(result.counted)void account.refreshLibrary();},failed:error=>{if(!disposed&&[401,403,404,410].includes(error.status))void denial.current?.();}});
  function sample(){const at=performance.now(),elapsed=(at-previousTime)/1000,advance=el.currentTime-previous;
   if(state==='PLAYING'&&!seeking&&document.visibilityState==='visible'&&elapsed>0&&advance>0&&advance<=elapsed*2.5+1)played=Math.min(45,played+Math.min(elapsed,advance));
   previous=el.currentTime;previousTime=at;
  }
  function report(){sample();if(!Number.isFinite(el.currentTime))return;
   const seconds=Math.min(45,played);played=0;
   void session.queue.report({position:el.currentTime,state,playing:seconds>0,seeking,playedSeconds:seconds});
  }
  const playing=()=>{sample();state='PLAYING';report();},pause=()=>{sample();state='PAUSED';report();},waiting=()=>{sample();state='BUFFERING';report();},seekStart=()=>{sample();seeking=true;report();},seekEnd=()=>{sample();seeking=false;state=el.paused?'PAUSED':'BUFFERING';report();},loaded=()=>{state=el.paused?'PAUSED':'BUFFERING';report();};
  const leave=()=>{sample();if(state!=='PAUSED')state='DISCONNECTED';report();};
  const events={playing,pause,ended:pause,waiting,seeking:seekStart,seeked:seekEnd,loadedmetadata:loaded,timeupdate:sample};
  for(const [name,fn]of Object.entries(events))el.addEventListener(name,fn);
  addEventListener('pagehide',leave);const timer=setInterval(report,30000);
  if(el.readyState>0)loaded();
  return()=>{disposed=true;leave();clearInterval(timer);removeEventListener('pagehide',leave);for(const [name,fn]of Object.entries(events))el.removeEventListener(name,fn);};
 },[video?.id,revision,enabled,account.user?.id,authorizedSessionId]);
}
