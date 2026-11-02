import {useEffect,useRef} from 'react';
import {api} from '../services/api.mjs';
import {useAccount} from './useAccount';
export function useQualifiedView(player,video,revision,enabled=true,authorizedSessionId){
  const account=useAccount(),statistics=useRef(null);
  useEffect(()=>{
    const el=player.current;if(!el||!video||!enabled||!authorizedSessionId)return;
    // Statistics use the authorized session; they never mint a separate grant.
    // A player retry keeps its authorized session, heartbeat sequence and queue.
    if(statistics.current?.id!==authorizedSessionId)statistics.current={id:authorizedSessionId,sequence:0,queue:Promise.resolve()};
    const session=statistics.current;let id=authorizedSessionId,active=false,seeking=false;
    function report(wasPlaying=active,wasSeeking=seeking){const position=el.currentTime;if(!id||!Number.isFinite(position))return;const ticket=id;session.queue=session.queue.then(async()=>{try{const result=await api(`/playback/${ticket}/heartbeat`,{method:'POST',keepalive:true,json:{sequence:session.sequence+1,position,playing:wasPlaying&&document.visibilityState==='visible',seeking:wasSeeking}});session.sequence++;if(result.counted)void account.refreshLibrary();}catch(error){if(error.status===404||error.status===409)id=null;}});}
    const playing=()=>{active=true;},pause=()=>{report(active);active=false;},waiting=()=>{active=false;report(false);},seekStart=()=>{seeking=true;report(false,true);},seekEnd=()=>{report(false,true);seeking=false;active=!el.paused;},visibility=()=>{if(document.hidden){active=false;report(false);}else if(!el.paused){active=true;}};
    const events={playing,pause,ended:pause,waiting,seeking:seekStart,seeked:seekEnd};for(const [name,handler] of Object.entries(events))el.addEventListener(name,handler);document.addEventListener('visibilitychange',visibility);
    if(!el.paused&&!el.ended&&document.visibilityState==='visible')playing();
    const timer=setInterval(()=>{if(active)report();},5000);
    return()=>{report(active);clearInterval(timer);for(const [name,handler] of Object.entries(events))el.removeEventListener(name,handler);document.removeEventListener('visibilitychange',visibility);};
  },[video?.id,revision,enabled,account.user?.id,authorizedSessionId]);
}
