import {useEffect,useRef,useState} from 'react';
import {Icon} from '../components/Icons';
import {Comments} from '../components/Comments';
import {Empty} from '../components/Common';
import {Link} from '../hooks/useRoute';
import {readLocal,writeLocal} from '../hooks/useLocal.mjs';
import {cacheMessage,api} from '../services/api.mjs';
import {duration,fileSize,formatOf} from '../utils/catalogue.mjs';
import {useQualifiedView} from '../hooks/useQualifiedView.mjs';
import {useAccount} from '../hooks/useAccount';
import {LikeButton} from '../components/LikeButton';
import {usePlayback} from '../hooks/usePlayback.mjs';
export function VideoPage({video:catalogueVideo,saved,onSave,loading,sourceUrl}){
  const account=useAccount(),progressKey=id=>`progress:${account.user?.id||'guest'}:${id}`;
  const [detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(true);
  const requestedId=location.pathname.split('/')[2],video=catalogueVideo||detail;
  // Return to the catalogue that opened this video; Home includes Trending.
  const returnPath=['/','/browse','/saved','/me/liked','/me/watched'].includes(history.state?.from)?history.state.from:'/';
  const returnLabel=returnPath==='/'?'Back to Home':returnPath==='/browse'?'Back to Search':'Back to videos';
  useEffect(()=>{if(catalogueVideo){setDetailLoading(false);return;}if(loading)return;const abort=new AbortController();setDetailLoading(true);api(`/videos/${encodeURIComponent(requestedId)}`,{signal:abort.signal}).then(setDetail).catch(()=>{}).finally(()=>{if(!abort.signal.aborted)setDetailLoading(false);});return()=>abort.abort();},[catalogueVideo?.id,loading,requestedId]);
  const player=useRef(null),lastSave=useRef(0),[error,setError]=useState(''),[waiting,setWaiting]=useState(false),[ready,setReady]=useState(false),[revision,setRevision]=useState(0),[resume,setResume]=useState(()=>video?readLocal(progressKey(video.id),null):null),[localError,setLocalError]=useState(false);
  const authorization=usePlayback(video,player,!sourceUrl);
  useQualifiedView(player,video,revision,!sourceUrl,authorization.id,authorization.sequence,authorization.revalidate);
  useEffect(()=>{setResume(video?readLocal(progressKey(video.id),null):null);setError('');setReady(false);},[video?.id,account.user?.id]);
  useEffect(()=>{if(!video||!account.user||sourceUrl)return;const abort=new AbortController();api(`/me/videos/${video.id}/progress`,{signal:abort.signal}).then(data=>{if(data.progress?.position>1)setResume(data.progress);}).catch(()=>{});return()=>abort.abort();},[video?.id,account.user?.id]);
  useEffect(()=>{if(authorization.position>1)setResume({position:authorization.position,completed:false});},[authorization.id]);
  useEffect(()=>{const el=player.current;if(!el||!video)return;const persist=()=>{if(Number.isFinite(el.duration)&&el.currentTime>0){const ok=writeLocal(progressKey(video.id),{videoId:video.id,position:el.currentTime,completed:el.ended||el.currentTime/el.duration>.95,lastWatched:new Date().toISOString()});if(!ok)setLocalError(true);}};const update=()=>{if(Date.now()-lastSave.current>30000){persist();lastSave.current=Date.now();}};el.addEventListener('timeupdate',update);el.addEventListener('pause',persist);el.addEventListener('ended',persist);addEventListener('pagehide',persist);return()=>{persist();el.removeEventListener('timeupdate',update);el.removeEventListener('pause',persist);el.removeEventListener('ended',persist);removeEventListener('pagehide',persist);};},[video?.id,revision,account.user?.id,authorization.id]);
  async function playError(){
    setWaiting(false);const code=player.current?.error?.code;
    if(!sourceUrl&&authorization.streamUrl){
      try{const response=await fetch(authorization.streamUrl,{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok){if([401,403,410].includes(response.status))await authorization.revalidate();setError(response.status===404?'This video is no longer available.':[429,503].includes(response.status)?'Playback or its source is temporarily busy. Please try again shortly.':'Playback access or the connection was interrupted. Please try again.');return;}
      }catch{setError('The stream could not be reached. Check your connection and try again.');return;}
    }
    setError(code===4?'This browser cannot play this video’s container or codec. Try a compatible browser or media player.':code===3?'This browser could not decode the video. Its codec may be unsupported.':'The stream was interrupted. Check your connection and try again.');
  }
  async function retryWithoutCache(){await cacheMessage({enabled:false});setError('');setRevision(n=>n+1);}
  if(loading||(!video&&detailLoading))return <div className="page-content"><p role="status">Loading video…</p></div>;
  if(!video)return <Empty title="Video not found">Return to Search to find an available video.</Empty>;
  if(!sourceUrl&&!authorization.streamUrl)return <div className="watch-page"><Link className="back-link" to={returnPath}><Icon name="left" size={18}/>{returnLabel}</Link><section className="membership-gate"><Icon name="premium" size={34}/><p className="eyebrow">{video.accessType==='FREE'?'FREE VIDEO':'VIP VIDEO'}</p><h1>{video.title}</h1><p>{duration(video.durationSeconds)} · {formatOf(video)}</p>{authorization.loading||account.loading?<p role="status">Checking playback access…</p>:authorization.membershipRequired?<><h2>Watch with a VIP membership</h2><p>Choose a package, then sign in or create your account. Playback becomes available after your membership is activated.</p><Link className="gold-button" to={`/premium?video=${encodeURIComponent(video.id)}`}>Choose a membership</Link>{account.user&&<button className="text-button" onClick={()=>{void account.refresh();authorization.retry();}}>Check my access again</button>}</>:<><p role="alert">{authorization.error||'Playback is unavailable. Please try again.'}</p><button className="gold-button" onClick={authorization.retry}>Try again</button></>}</section></div>;
  return <div className="watch-page"><Link className="back-link" to={returnPath}><Icon name="left" size={18}/> {returnLabel}</Link><div className="player-frame">
    <video ref={player} key={`${video.id}-${revision}`} controls playsInline preload="metadata" poster={video.artwork||undefined} src={sourceUrl||authorization.streamUrl} onWaiting={()=>setWaiting(true)} onPlaying={()=>setWaiting(false)} onCanPlay={()=>setWaiting(false)} onLoadedMetadata={()=>{setReady(true);setWaiting(false);}} onError={playError} aria-label={video.title}/>
    {waiting&&!error&&<div className="player-loading" role="status"><Icon name="loading" size={30} className="spin"/><span>Loading video…</span></div>}
    {error&&<div className="player-error" role="alert"><Icon name="error" size={32}/><h2>Unable to play this video</h2><p>{error}</p><button className="gold-button" onClick={()=>{setError('');setRevision(n=>n+1);}}>Try again</button><button className="text-button" onClick={retryWithoutCache}>Retry with device caching off</button></div>}
  </div>
  <div className="player-toolbar"><button className="nav-pill" disabled={!ready||!!error} onClick={()=>{player.current.currentTime=Math.max(0,player.current.currentTime-10);}}><Icon name="resume" size={16}/> −10s</button><button className="nav-pill" disabled={!ready||!!error} onClick={()=>{player.current.currentTime=Math.min(player.current.duration,player.current.currentTime+10);}}>+10s <Icon name="arrow" size={16}/></button><span>Original quality</span></div>
  {resume?.position>1&&!resume.completed&&<div className="resume-banner"><span>Pick up where you left off · {duration(resume.position)}</span><button className="gold-button" disabled={!ready||!!error} onClick={()=>{player.current.currentTime=Math.min(resume.position,player.current.duration);player.current.play().catch(()=>{});setResume(null);}}>Resume</button><button className="text-button" onClick={()=>{player.current.currentTime=0;player.current.play().catch(()=>{});setResume(null);}}>Start Over</button></div>}
  <div className="video-heading"><div><p className="eyebrow">YOUR VIDEO LIBRARY</p><h1>{video.title}</h1></div>{!sourceUrl&&<LikeButton video={video}/>}<button className={`nav-pill ${saved.includes(video.id)?'current':''}`} aria-pressed={saved.includes(video.id)} onClick={()=>onSave(video.id)}><Icon name="saved"/>{saved.includes(video.id)?'Saved':'Save'}</button></div>
  <div className="video-meta"><span>{formatOf(video)}</span><span>{fileSize(video.sizeBytes)}</span><span>Added {new Date(video.uploadedAt).toLocaleDateString()}</span>{duration(video.durationSeconds)&&<span>{duration(video.durationSeconds)}</span>}</div>
  {video.titleUnverified&&<p className="section-note">Title identified from the filename.</p>}<p className="description">{video.description||'No description is available for this video.'}</p><details className="file-details"><summary>File details</summary><p>{video.filename}</p><p>{video.mimeType||'Media type unavailable'}</p></details>{localError&&<p role="status">Playback progress couldn't be saved on this device.</p>}<Comments videoId={video.id}/>
  </div>;
}
