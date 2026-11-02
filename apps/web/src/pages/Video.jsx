import {useEffect,useRef,useState} from 'react';
import {Icon} from '../components/Icons';
import {Comments} from '../components/Comments';
import {Empty} from '../components/Common';
import {Link} from '../hooks/useRoute';
import {readLocal,writeLocal} from '../hooks/useLocal.mjs';
import {streamUrl,cacheMessage,api} from '../services/api.mjs';
import {duration,fileSize,formatOf} from '../utils/catalogue.mjs';
import {useQualifiedView} from '../hooks/useQualifiedView.mjs';
import {useAccount} from '../hooks/useAccount';
import {LikeButton} from '../components/LikeButton';
export function VideoPage({video:catalogueVideo,saved,onSave,loading,sourceUrl}){
  const account=useAccount(),progressKey=id=>`progress:${account.user?.id||'guest'}:${id}`;
  const [detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(true);
  const requestedId=location.pathname.split('/')[2],video=catalogueVideo||detail;
  useEffect(()=>{if(catalogueVideo){setDetailLoading(false);return;}if(loading)return;const abort=new AbortController();setDetailLoading(true);api(`/videos/${encodeURIComponent(requestedId)}`,{signal:abort.signal}).then(setDetail).catch(()=>{}).finally(()=>{if(!abort.signal.aborted)setDetailLoading(false);});return()=>abort.abort();},[catalogueVideo?.id,loading,requestedId]);
  const player=useRef(null),lastSave=useRef(0),[error,setError]=useState(''),[waiting,setWaiting]=useState(false),[ready,setReady]=useState(false),[revision,setRevision]=useState(0),[resume,setResume]=useState(()=>video?readLocal(progressKey(video.id),null):null),[localError,setLocalError]=useState(false);
  useQualifiedView(player,video,revision,!sourceUrl);
  useEffect(()=>{setResume(video?readLocal(progressKey(video.id),null):null);setError('');setReady(false);},[video?.id,account.user?.id]);
  useEffect(()=>{const el=player.current;if(!el||!video)return;const persist=()=>{if(Number.isFinite(el.duration)&&el.currentTime>0){const ok=writeLocal(progressKey(video.id),{videoId:video.id,position:el.currentTime,completed:el.ended||el.currentTime/el.duration>.95,lastWatched:new Date().toISOString()});if(!ok)setLocalError(true);}};const update=()=>{if(Date.now()-lastSave.current>2000){persist();lastSave.current=Date.now();}};el.addEventListener('timeupdate',update);el.addEventListener('pause',persist);el.addEventListener('ended',persist);addEventListener('pagehide',persist);return()=>{persist();el.removeEventListener('timeupdate',update);el.removeEventListener('pause',persist);el.removeEventListener('ended',persist);removeEventListener('pagehide',persist);};},[video?.id,revision,account.user?.id]);
  function playError(){setWaiting(false);setError(player.current?.error?.code===4?'This browser cannot play this video’s container or codec. Try a compatible browser or media player.':player.current?.error?.code===3?'This browser could not decode the video. Its codec may be unsupported.':'The stream was interrupted or is unavailable. Check your connection and try again.');}
  async function retryWithoutCache(){await cacheMessage({enabled:false});setError('');setRevision(n=>n+1);}
  if(loading||(!video&&detailLoading))return <div className="page-content"><p role="status">Loading video…</p></div>;
  if(!video)return <Empty title="Video not found">Return to Search to find an available video.</Empty>;
  return <div className="watch-page"><Link className="back-link" to="/browse"><Icon name="left" size={18}/> Back to videos</Link><div className="player-frame">
    <video ref={player} key={`${video.id}-${revision}`} controls playsInline preload="metadata" poster={video.artwork||undefined} src={sourceUrl||streamUrl(video.id)} onWaiting={()=>setWaiting(true)} onPlaying={()=>setWaiting(false)} onCanPlay={()=>setWaiting(false)} onLoadedMetadata={()=>{setReady(true);setWaiting(false);}} onError={playError} aria-label={video.title}/>
    {waiting&&!error&&<div className="player-loading" role="status"><Icon name="loading" size={30} className="spin"/><span>Loading video…</span></div>}
    {error&&<div className="player-error" role="alert"><Icon name="error" size={32}/><h2>Unable to play this video</h2><p>{error}</p><button className="gold-button" onClick={()=>{setError('');setRevision(n=>n+1);}}>Try again</button><button className="text-button" onClick={retryWithoutCache}>Retry with device caching off</button></div>}
  </div>
  <div className="player-toolbar"><button className="nav-pill" disabled={!ready||!!error} onClick={()=>{player.current.currentTime=Math.max(0,player.current.currentTime-10);}}><Icon name="resume" size={16}/> −10s</button><button className="nav-pill" disabled={!ready||!!error} onClick={()=>{player.current.currentTime=Math.min(player.current.duration,player.current.currentTime+10);}}>+10s <Icon name="arrow" size={16}/></button><span>Original quality</span></div>
  {resume?.position>1&&!resume.completed&&<div className="resume-banner"><span>Pick up where you left off · {duration(resume.position)}</span><button className="gold-button" disabled={!ready||!!error} onClick={()=>{player.current.currentTime=Math.min(resume.position,player.current.duration);player.current.play().catch(()=>{});setResume(null);}}>Resume</button><button className="text-button" onClick={()=>setResume(null)}>Start fresh</button></div>}
  <div className="video-heading"><div><p className="eyebrow">YOUR VIDEO LIBRARY</p><h1>{video.title}</h1></div>{!sourceUrl&&<LikeButton video={video}/>}<button className={`nav-pill ${saved.includes(video.id)?'current':''}`} aria-pressed={saved.includes(video.id)} onClick={()=>onSave(video.id)}><Icon name="saved"/>{saved.includes(video.id)?'Saved':'Save'}</button></div>
  <div className="video-meta"><span>{formatOf(video)}</span><span>{fileSize(video.sizeBytes)}</span><span>Added {new Date(video.uploadedAt).toLocaleDateString()}</span>{duration(video.durationSeconds)&&<span>{duration(video.durationSeconds)}</span>}</div>
  {video.titleUnverified&&<p className="section-note">Title identified from the filename.</p>}<p className="description">{video.description||'No description is available for this video.'}</p><details className="file-details"><summary>File details</summary><p>{video.filename}</p><p>{video.mimeType||'Media type unavailable'}</p></details>{localError&&<p role="status">Playback progress couldn't be saved on this device.</p>}<Comments videoId={video.id}/>
  </div>;
}
