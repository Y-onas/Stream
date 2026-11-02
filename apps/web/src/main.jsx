import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Shell} from './layouts/Shell';
import {Catalogue} from './pages/Catalogue';
import {VideoPage} from './pages/Video';
import {Me} from './pages/Me';
import {Empty} from './components/Common';
import {useRoute,Link} from './hooks/useRoute';
import {useLocal} from './hooks/useLocal.mjs';
import {api,startCache} from './services/api.mjs';
import './styles/main.css';
import {AccountProvider,useAccount,AccountRequired} from './hooks/useAccount';
import {PlansPage,AccountPage,SubscribePage} from './pages/Subscription';
function App(){
  const account=useAccount(),path=useRoute(),[query,setQuery]=useState(''),[legacySaved,setLegacySaved]=useLocal('saved',[]),[catalogue,setCatalogue]=useState({items:[],loading:true}),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();let busy=false;
    const refresh=async()=>{if(busy)return;busy=true;try{const data=await api('/videos',{signal:abort.signal});setCatalogue({...data,loading:false});}catch(e){if(e.name!=='AbortError')setCatalogue(old=>({...old,loading:false,error:true}));}finally{busy=false;}};
    refresh();const timer=setInterval(refresh,15000);const focus=()=>refresh();addEventListener('focus',focus);
    return()=>{abort.abort();clearInterval(timer);removeEventListener('focus',focus);};
  },[retry]);
  useEffect(()=>{startCache();},[]);
  // Legacy device bookmarks remain stored; account collections never import them.
  const saved=account.library?.savedIds||[];
  const onSave=id=>void account.toggleVideo(id,'saved');
  let content;
  if(['/','/browse','/saved'].includes(path))content=<Catalogue key={`${path}:${account.user?.id||'guest'}`} videos={catalogue.items} loading={catalogue.loading} error={catalogue.error} retry={()=>setRetry(n=>n+1)} query={query} saved={saved} onSave={onSave} page={path==='/saved'?'saved':path==='/browse'?'browse':'home'}/>;
  else if(path.startsWith('/video/'))content=<VideoPage key={path} video={catalogue.items.find(v=>v.id===path.split('/')[2])} loading={catalogue.loading} saved={saved} onSave={onSave}/>;
  else if(['/me','/me/watched','/me/liked','/me/membership'].includes(path))content=<Me path={path} videos={catalogue.items}/>;
  else if(path==='/premium')content=<PlansPage/>;
  else if(path==='/account')content=<AccountPage/>;
  else if(path==='/subscribe')content=<SubscribePage/>;
  else content=<Empty title="Page not found"><Link to="/">Return home</Link></Empty>;
  if(path==='/saved'&&(account.loading||!account.user))content=<AccountRequired/>;
  if(account.platform?.maintenanceMode)content=<div className="purchase-page"><p className="eyebrow">{account.platform.platformName}</p><h1>Maintenance</h1><p className="muted">{account.platform.maintenanceMessage}</p></div>;
  return <Shell path={path} query={query} setQuery={setQuery}>{account.logoutWarning&&<p className="form-error account-library-error" role="alert">{account.logoutWarning}</p>}{account.libraryError&&account.user&&<p className="form-error account-library-error" role="alert">{account.libraryError}</p>}{content}</Shell>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><AccountProvider><App/></AccountProvider></React.StrictMode>);
