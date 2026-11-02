import {useEffect} from 'react';
import {api} from '../services/api.mjs';
import {useAccount} from './useAccount';
export function useQualifiedView(player,video,revision,enabled=true){
  const account=useAccount();
  useEffect(()=>{
    const el=player.current;if(!el||!video||!enabled)return;
    let id=null,sequence=0,creating=null,active=false,seeking=false,closed=false,queue=Promise.resolve();
    async function ensure(){if(id||creating||closed)return creating;creating=api(`/videos/${encodeURIComponent(video.id)}/playback`,{method:'POST',json:{position:el.currentTime}}).then(data=>{if(!closed){id=data.id;sequence=0;}}).catch(()=>{}).finally(()=>{creating=null;});return creating;}
    function report(wasPlaying=active,wasSeeking=seeking){const position=el.currentTime;if(!id||!Number.isFinite(position))return;const ticket=id;queue=queue.then(async()=>{try{const result=await api(`/playback/${ticket}/heartbeat`,{method:'POST',keepalive:true,json:{sequence:sequence+1,position,playing:wasPlaying&&document.visibilityState==='visible',seeking:wasSeeking}});sequence++;if(result.counted)void account.refreshLibrary();}catch(error){if(error.status===404||error.status===409){id=null;sequence=0;}}});}
    const playing=()=>{active=true;void ensure();},pause=()=>{report(active);active=false;},waiting=()=>{active=false;report(false);},seekStart=()=>{seeking=true;report(false,true);},seekEnd=()=>{report(false,true);seeking=false;active=!el.paused;},visibility=()=>{if(document.hidden){active=false;report(false);}else if(!el.paused){active=true;void ensure();}};
    const events={playing,pause,ended:pause,waiting,seeking:seekStart,seeked:seekEnd};for(const [name,handler] of Object.entries(events))el.addEventListener(name,handler);document.addEventListener('visibilitychange',visibility);
    if(!el.paused&&!el.ended&&document.visibilityState==='visible')playing();
    const timer=setInterval(()=>{if(active){void ensure();report();}},5000);
    return()=>{report(active);closed=true;clearInterval(timer);for(const [name,handler] of Object.entries(events))el.removeEventListener(name,handler);document.removeEventListener('visibilitychange',visibility);};
  },[video?.id,revision,enabled,account.user?.id]);
}
