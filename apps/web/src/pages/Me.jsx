import {useEffect,useState} from 'react';
import {cacheMessage} from '../services/api.mjs';
import {Icon} from '../components/Icons';
import {Link} from '../hooks/useRoute';
import {ProfileFeatureEntry} from '../components/ProfileFeatureEntry';
import {ProfileDesign} from '../components/ProfileDesign';
export function Me({path='/me',videos=[]}){
  // Preserve the previous controls and their implementation without exposing
  // device storage or the old placeholder profile in the product UI.
  const showLegacyProfile=false;
  const [storage,setStorage]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(showLegacyProfile)cacheMessage().then(setStorage);},[showLegacyProfile]);
  async function configure(options){setBusy(true);const result=await cacheMessage(options);setStorage(result);setNotice(result.ok?(options.clear?'Cached video data cleared.':'Device storage updated.'):result.message);setBusy(false);}
  return <><ProfileDesign path={path} videos={videos}/>{showLegacyProfile&&<div className="page-content profile-page"><p className="eyebrow">YOUR HABESHAN HUB</p><h1>Your space.</h1><p className="muted">Your saved videos and playback progress stay on this device. Accounts are coming later.</p><Link className="nav-pill watchlist-link" to="/saved"><Icon name="saved"/>Your Watchlist<Icon name="right" size={16}/></Link>
  <section className="profile-features" aria-label="Upcoming profile features">
    <ProfileFeatureEntry icon="liked" label="Liked" description="A place for videos you like."/>
    <ProfileFeatureEntry icon="premium" label="Membership" description="Membership status and expiration will appear here."/>
    <ProfileFeatureEntry icon="support" label="Contact Support" description="Telegram support will be available here."/>
  </section>
  <section className="settings-panel"><h2><Icon name="storage"/> Device storage</h2><p>Keep recently watched video segments here to avoid downloading them again. This doesn't save a complete video for offline viewing.</p>
  {!storage?<p role="status">Checking storage…</p>:!storage.ok?<p role="status">{storage.message}</p>:<><div className="settings-row"><label htmlFor="cache-enabled">Cache video segments</label><input id="cache-enabled" type="checkbox" checked={storage.enabled} disabled={busy} onChange={e=>configure({enabled:e.target.checked})}/></div><div className="settings-row"><label htmlFor="cache-limit">Storage limit</label><select id="cache-limit" value={storage.limit/(1024*1024)} disabled={busy} onChange={e=>configure({limit:Number(e.target.value)*1024*1024})}>{[32,64,128,256,512].map(n=><option value={n} key={n}>{n} MB</option>)}</select></div><div className="storage-meter"><span style={{width:`${Math.min(100,storage.total/storage.limit*100)}%`}}/></div><p className="section-note">{(storage.total/(1024*1024)).toFixed(1)} MB used of {storage.limit/(1024*1024)} MB. Older segments are removed first.</p><button className="nav-pill" disabled={busy} onClick={()=>configure({clear:true})}><Icon name="trash" size={17}/>Clear cached video data</button></>}
  {notice&&<p role="status">{notice}</p>}</section></div>}</>;
}
