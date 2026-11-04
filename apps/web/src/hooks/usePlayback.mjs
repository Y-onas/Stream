import {useEffect,useState,useRef} from 'react';
import {api} from '../services/api.mjs';
import {useAccount} from './useAccount';

export function usePlayback(video,player,enabled=true){
 const account=useAccount(),[state,setState]=useState({loading:true}),[attempt,setAttempt]=useState(0),renewRef=useRef(()=>Promise.resolve());
 useEffect(()=>{
  if(!enabled||!video||account.loading)return;
  const abort=new AbortController();let closed=false,timer,session,expires=0,renewing=false;
  const storageKey=`hh:playback:${account.user?.id||'guest'}:${video.id}`;
  let identity;try{identity=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  if(!identity||!uuid(identity.requestId)||(identity.sessionId!==undefined&&!uuid(identity.sessionId)))identity={requestId:crypto.randomUUID()};
  const saveIdentity=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(identity));}catch{}};saveIdentity();
  setState({loading:true});
  const stop=error=>{if(closed)return;clearTimeout(timer);if(error.status===401||error.status===410||['PLAYBACK_SESSION_EXPIRED','PLAYBACK_SESSION_REVOKED','PLAYBACK_ACCESS_CHANGED','MEMBERSHIP_REQUIRED','ACCESS_EXPIRED'].includes(error.code)){identity={requestId:crypto.randomUUID()};saveIdentity();}const el=player.current;if(el){el.pause();el.removeAttribute('src');el.load();}setState({loading:false,error:error.message,membershipRequired:video.accessType==='VIP'&&(error.status===401||error.code==='MEMBERSHIP_REQUIRED'||error.code==='ACCESS_EXPIRED'),code:error.code});};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void renew(),Math.max(1000,expires-Date.now()-Math.min(60000,Math.max(5000,(expires-Date.now())/3))));};
  async function renew(){if(closed||!session||renewing)return;renewing=true;try{const next=await api(`/playback/${session.id}/renew`,{method:'POST',json:{},signal:abort.signal});if(closed)return;expires=Date.parse(next.expiresAt);schedule();}catch(error){if(closed||error.name==='AbortError')return;if((!error.status||error.status>=500)&&Date.now()+2000<expires){timer=setTimeout(()=>void renew(),2000);return;}stop(error);}finally{renewing=false;}}
  renewRef.current=renew;
  const focus=()=>{if(session&&Date.now()>expires-60000)void renew();};
  void api('/playback/authorize',{method:'POST',json:{videoId:video.id,position:0,...identity},signal:abort.signal}).then(data=>{if(closed)return;session=data;identity.sessionId=data.id;saveIdentity();expires=Date.parse(data.expiresAt);setState({...data,loading:false});schedule();}).catch(error=>{if(error.name!=='AbortError')stop(error);});
  addEventListener('focus',focus);
  return()=>{closed=true;abort.abort();clearTimeout(timer);removeEventListener('focus',focus);if(session)void api(`/playback/${session.id}/disconnect`,{method:'POST',json:{},keepalive:true}).catch(()=>{});};
 },[video?.id,account.loading,account.user?.id,enabled,attempt]);
 return{...state,retry:()=>setAttempt(n=>n+1),revalidate:()=>renewRef.current()};
}
