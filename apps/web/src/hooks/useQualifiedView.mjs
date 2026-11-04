import {useEffect,useRef} from 'react';
import {api} from '../services/api.mjs';
import {useAccount} from './useAccount';
export function useQualifiedView(player,video,revision,enabled=true,authorizedSessionId,initialSequence=0,onDenied){
 const account=useAccount(),statistics=useRef(null),denial=useRef(onDenied);denial.current=onDenied;
 useEffect(()=>{
  const el=player.current;if(!el||!video||!enabled||!authorizedSessionId)return;
  if(statistics.current?.id!==authorizedSessionId)statistics.current={id:authorizedSessionId,sequence:initialSequence,busy:false,pending:null};
  const session=statistics.current;let disposed=false,state='BUFFERING',seeking=false,played=0,previous=el.currentTime,previousTime=performance.now();
  function sample(){const at=performance.now(),elapsed=(at-previousTime)/1000,advance=el.currentTime-previous;
   if(state==='PLAYING'&&!seeking&&document.visibilityState==='visible'&&elapsed>0&&advance>0&&advance<=elapsed*2.5+1)played=Math.min(45,played+Math.min(elapsed,advance));
   previous=el.currentTime;previousTime=at;
  }
  async function drain(){if(session.busy||!session.pending)return;session.busy=true;const report=session.pending;session.pending=null;
   try{const result=await api(`/playback/${session.id}/heartbeat`,{method:'POST',keepalive:true,signal:AbortSignal.timeout(10000),json:{...report,sequence:session.sequence+1}});session.sequence++;if(result.counted)void account.refreshLibrary();}
   catch(error){if(!disposed&&[401,403,404,410].includes(error.status))void denial.current?.();/* Temporary failures retry on the next bounded heartbeat. */}
   finally{session.busy=false;if(session.pending)void drain();}
  }
  function report(){sample();if(!Number.isFinite(el.currentTime))return;
   const seconds=Math.min(45,played+(session.pending?.playedSeconds||0));played=0;
   // One in-flight request and one coalesced latest report bound the queue.
   session.pending={position:el.currentTime,state,playing:seconds>0,seeking,playedSeconds:seconds};void drain();
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
