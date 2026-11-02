import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {api,clearCacheAfterLogout} from '../services/api.mjs';
import {Link,navigate} from './useRoute';
const Context=createContext(null);
export function AccountProvider({children}){
  const [account,setAccount]=useState({user:null,membership:null,loading:true}),[platform,setPlatform]=useState(null),[library,setLibrary]=useState(null),[libraryError,setLibraryError]=useState(''),[logoutWarning,setLogoutWarning]=useState('');
  const pending=useRef(new Set()),authVersion=useRef(0);
  async function refresh(){const version=++authVersion.current;try{const data=await api('/auth/me');if(version===authVersion.current)setAccount({...data,loading:false});return data;}catch(error){if(version===authVersion.current)setAccount({user:null,membership:null,loading:false,error:error.message});}}
  useEffect(()=>{void refresh();const abort=new AbortController(),configuration=()=>api('/config',{signal:abort.signal}).then(data=>{setPlatform(data);document.title=data.platformName||'Habeshan HUB';}).catch(()=>{});void configuration();const timer=setInterval(configuration,15000),focus=()=>{void refresh();void configuration();};addEventListener('focus',focus);return()=>{abort.abort();clearInterval(timer);removeEventListener('focus',focus);};},[]);
  async function refreshLibrary(signal){if(!account.user)return;const userId=account.user.id;try{const data=await api('/me/library',{signal});if(data.userId!==userId){setLibrary(null);await refresh();return;}setLibrary(data);setLibraryError('');}catch(error){if(error.name!=='AbortError'){setLibraryError(error.message);if(error.status===401)void refresh();}}}
  useEffect(()=>{setLibrary(null);setLibraryError('');if(!account.user)return;const abort=new AbortController();void refreshLibrary(abort.signal);const timer=setInterval(()=>void refreshLibrary(abort.signal),15000),focus=()=>void refreshLibrary(abort.signal);addEventListener('focus',focus);return()=>{abort.abort();clearInterval(timer);removeEventListener('focus',focus);};},[account.user?.id]);
  async function logout(){await api('/auth/logout',{method:'POST',json:{}});setLibrary(null);setLogoutWarning('');const [,warning]=await Promise.all([refresh(),clearCacheAfterLogout()]);setLogoutWarning(warning);}
  const ownedLibrary=library?.userId===account.user?.id?library:null;
  async function toggleVideo(id,kind){
    if(account.loading)return;
    if(!account.user){navigate('/account?mode=login');return;}
    if(!ownedLibrary)return;
    const key=`${account.user.id}:${kind}:${id}`;if(pending.current.has(key))return;pending.current.add(key);setLibraryError('');
    try{const selected=!(kind==='liked'?ownedLibrary.likedIds:ownedLibrary.savedIds).includes(id);await api(`/me/videos/${encodeURIComponent(id)}/${kind}`,{method:'POST',json:{selected}});await refreshLibrary();}catch(error){setLibraryError(error.message);if(error.status===401)void refresh();}finally{pending.current.delete(key);}
  }
  return <Context.Provider value={{...account,platform,refresh,logout,logoutWarning,library:ownedLibrary,libraryError,refreshLibrary,toggleVideo}}>{children}</Context.Provider>;
}
export const useAccount=()=>useContext(Context);
export function AccountRequired(){
  const account=useAccount();
  if(account.loading)return <div className="purchase-page"><p role="status">Checking your account…</p></div>;
  return <div className="purchase-page account-page guest-account"><p className="eyebrow">HABESHAN HUB</p><h1>Log in to your account.</h1><p className="muted">Your profile and video collections are linked to your account.</p>{account.error&&<p className="form-error" role="alert">{account.error}</p>}<div className="guest-account-actions"><Link className="gold-button" to="/account?mode=login">Log in</Link>{account.platform?.registrationOpen!==false&&<Link className="nav-pill" to="/account">Sign up</Link>}</div></div>;
}
