import {useEffect,useState,useRef} from 'react';
import {api} from '../services/api.mjs';
import {createPlaybackLifecycle} from '../services/playback-lifecycle.mjs';
import {lacksVipMembership} from '../services/playback-access.mjs';
import {useAccount} from './useAccount';

export function usePlayback(video,player,enabled=true){
 const account=useAccount(),[state,setState]=useState({loading:true}),[attempt,setAttempt]=useState(0),renewRef=useRef(()=>Promise.resolve());
 const blocked=enabled&&lacksVipMembership(account,video);
 const membershipKey=JSON.stringify([account.user?.id,account.membership?.id,account.membership?.status,account.membership?.expiresAt,account.membership?.revokedAt]),lastMembership=useRef(membershipKey);
 useEffect(()=>{
  if(lastMembership.current===membershipKey)return;lastMembership.current=membershipKey;
  // Reuse the provider's existing silent refresh. Only a real membership change
  // retries a denied player; ordinary refreshes never remount a working one.
  if(state.membershipRequired&&account.membership?.status==='ACTIVE')setAttempt(n=>n+1);
  else if(state.streamUrl&&!blocked)void renewRef.current();
 },[membershipKey,state.membershipRequired,state.streamUrl,blocked]);
 useEffect(()=>{
  if(blocked){setState({loading:true});return;}
  if(!enabled||!video||account.loading)return;
  const abort=new AbortController();let closed=false,timer,session,expires=0,renewing=null;
  const storageKey=`hh:playback:${account.user?.id||'guest'}:${video.id}`;
  let identity;try{identity=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
  const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  if(!identity||!uuid(identity.requestId)||(identity.sessionId!==undefined&&!uuid(identity.sessionId)))identity={requestId:crypto.randomUUID()};
  const saveIdentity=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(identity));}catch{}};saveIdentity();
  setState({loading:true});
  const stop=error=>{
   if(closed)return;clearTimeout(timer);
   if(error.status===401||error.status===410||['PLAYBACK_SESSION_EXPIRED','PLAYBACK_SESSION_REVOKED','PLAYBACK_ACCESS_CHANGED','MEMBERSHIP_REQUIRED','ACCESS_EXPIRED'].includes(error.code)){identity={requestId:crypto.randomUUID()};saveIdentity();}
   const el=player.current;if(el){el.pause();el.removeAttribute('src');el.load();}
   setState({loading:false,error:error.message,membershipRequired:video.accessType==='VIP'&&['MEMBERSHIP_REQUIRED','MEMBERSHIP_EXPIRED'].includes(error.code),code:error.code});
   if(video.accessType==='VIP'&&['MEMBERSHIP_REQUIRED','MEMBERSHIP_EXPIRED','PLAYBACK_SESSION_REVOKED','PLAYBACK_SESSION_EXPIRED','ACCESS_EXPIRED'].includes(error.code)){
    // A terminated playback is not proof that membership ended. Refresh only
    // after denial and distinguish it using the server's account response.
    void account.refresh().then(current=>{if(!closed&&current?.user&&current.user.id===account.user?.id&&!current.membership)setState(old=>old.code===error.code?{...old,membershipRequired:true}:old);});
   }
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void renew(),Math.max(1000,expires-Date.now()-Math.min(60000,Math.max(5000,(expires-Date.now())/3))));};
  function renew(){
   if(closed||!session)return Promise.resolve(false);if(renewing)return renewing;
   renewing=(async()=>{try{const next=await api(`/playback/${session.id}/renew`,{method:'POST',json:{},signal:abort.signal});if(closed)return false;expires=Date.parse(next.expiresAt);schedule();return true;}catch(error){if(closed||error.name==='AbortError')return false;if((!error.status||error.status>=500)&&Date.now()+2000<expires){timer=setTimeout(()=>void renew(),2000);return false;}stop(error);return false;}})().finally(()=>{renewing=null;});
   return renewing;
  }
  renewRef.current=renew;
  const focus=()=>{if(session&&Date.now()>expires-60000)void renew();};
  const requestIdentity={...identity};
  const lifecycle=createPlaybackLifecycle({
   // Do not abort an in-flight authorization on navigation: its response is
   // needed to terminate a session the server may already have created.
   authorize:()=>api('/playback/authorize',{method:'POST',json:{videoId:video.id,position:0,...requestIdentity},signal:AbortSignal.timeout(15000)}),
   terminate:data=>api(`/playback/${data.id}/terminate`,{method:'POST',json:{},keepalive:true,signal:AbortSignal.timeout(10000)})
  });
  void lifecycle.ready.then(data=>{if(closed||!data)return;session=data;identity.sessionId=data.id;saveIdentity();expires=Date.parse(data.expiresAt);setState({...data,loading:false});schedule();}).catch(error=>{if(!closed)stop(error);});
  const leave=()=>{
   if(closed)return;closed=true;abort.abort();clearTimeout(timer);
   try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.requestId===requestIdentity.requestId)sessionStorage.removeItem(storageKey);}catch{}
   void lifecycle.close();
  };
  const restore=event=>{if(event.persisted)setAttempt(n=>n+1);};
  addEventListener('focus',focus);
  addEventListener('pagehide',leave);addEventListener('pageshow',restore);
  return()=>{leave();removeEventListener('focus',focus);removeEventListener('pagehide',leave);removeEventListener('pageshow',restore);};
 },[video?.id,account.loading,account.user?.id,enabled,attempt,blocked]);
 return{...(blocked?{loading:false,membershipRequired:true,error:'An active VIP membership is required to watch this video.'}:state),retry:()=>setAttempt(n=>n+1),revalidate:()=>renewRef.current()};
}
