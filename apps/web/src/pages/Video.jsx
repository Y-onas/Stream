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
import {useVideoTransport} from '../hooks/useVideoTransport.mjs';
import {PlayerControls} from '../components/PlayerControls';
import {usePlayerStartup} from '../hooks/usePlayerStartup.mjs';
import {startupPosition,createResumeWindow} from '../services/player-startup.mjs';
import '../styles/player.css';
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
  const playbackLoading=!sourceUrl&&(authorization.loading||account.loading);
  const playbackFailure=!sourceUrl&&!playbackLoading?authorization.error:null;
  const transport=useVideoTransport(player,sourceUrl||authorization.streamUrl,video?.durationSeconds,revision,{setWaiting,setError,revalidate:authorization.revalidate});
  const [autoplayBlocked,setAutoplayBlocked]=useState(false),[resumeDismissed,setResumeDismissed]=useState(false);
  useQualifiedView(player,video,revision,!sourceUrl,authorization.id,authorization.sequence,authorization.revalidate);
  useEffect(()=>{setResume(video?readLocal(progressKey(video.id),null):null);setResumeDismissed(false);setError('');setReady(false);},[video?.id,account.user?.id]);
  useEffect(()=>{if(!video||!account.user||sourceUrl)return;const abort=new AbortController();api(`/me/videos/${video.id}/progress`,{signal:abort.signal}).then(data=>{if(data.progress?.position>1)setResume(data.progress);}).catch(()=>{});return()=>abort.abort();},[video?.id,account.user?.id]);
  useEffect(()=>{if(authorization.position>1)setResume({position:authorization.position,completed:false});},[authorization.id]);
  usePlayerStartup(player,sourceUrl||authorization.streamUrl,revision,{
    // Start promptly at the beginning. Saved progress is an optional action,
    // prepared independently; a late progress response must never seek the video.
    position:()=>0,
    start:transport.startAt,
    onStarting:()=>{setAutoplayBlocked(false);setWaiting(true);},
    onStarted:()=>{setAutoplayBlocked(false);setWaiting(false);},
    onBlocked:()=>{setAutoplayBlocked(true);setWaiting(false);},
    onStopped:()=>{if(player.current?.paused&&player.current?.getAttribute('src'))setWaiting(false);}
  });
  const resumePosition=startupPosition({account:resume,authorized:authorization.position});
  useEffect(()=>{
    const el=player.current;if(!el)return;
    const suggestion=createResumeWindow(()=>setResumeDismissed(true));
    el.addEventListener('playing',suggestion.start);
    if(!el.paused&&el.readyState>=3)suggestion.start();
    return()=>{suggestion.close();el.removeEventListener('playing',suggestion.start);};
  },[video?.id,revision,authorization.id,sourceUrl]);
  useEffect(()=>{const el=player.current;if(!el||!video)return;const persist=()=>{if(Number.isFinite(el.duration)&&el.currentTime>0){const ok=writeLocal(progressKey(video.id),{videoId:video.id,position:el.currentTime,completed:el.ended||el.currentTime/el.duration>.95,lastWatched:new Date().toISOString()});if(!ok)setLocalError(true);}};const update=()=>{if(Date.now()-lastSave.current>30000){persist();lastSave.current=Date.now();}};el.addEventListener('timeupdate',update);el.addEventListener('pause',persist);el.addEventListener('ended',persist);addEventListener('pagehide',persist);return()=>{persist();el.removeEventListener('timeupdate',update);el.removeEventListener('pause',persist);el.removeEventListener('ended',persist);removeEventListener('pagehide',persist);};},[video?.id,revision,account.user?.id,authorization.id]);
  async function retryWithoutCache(){await cacheMessage({enabled:false});setError('');setRevision(n=>n+1);}
  if(loading||(!video&&detailLoading))return <div className="page-content"><p role="status">Loading video…</p></div>;
  if(!video)return <Empty title="Video not found">Return to Search to find an available video.</Empty>;
  // A known non-member is denied immediately. The player frame is visible to
  // members while authorization loads, but contains no media element or URL.
  if(!sourceUrl&&!playbackLoading&&authorization.membershipRequired)return <div className="watch-page"><Link className="back-link" to={returnPath}><Icon name="left" size={18}/>{returnLabel}</Link><section className="membership-gate"><Icon name="premium" size={34}/><p className="eyebrow">VIP VIDEO</p><h1>{video.title}</h1><p>{duration(video.durationSeconds)} · {formatOf(video)}</p><h2>Watch with a VIP membership</h2><p>{authorization.error||'An active VIP membership is required to watch this video.'}</p><Link className="gold-button" to={`/premium?video=${encodeURIComponent(video.id)}`}>Choose a membership</Link>{account.user&&<button className="text-button" onClick={()=>{void account.refresh();authorization.retry();}}>Retry playback</button>}</section></div>;
  return <div className="watch-page"><Link className="back-link" to={returnPath}><Icon name="left" size={18}/> {returnLabel}</Link><div className="player-frame" tabIndex={0} role="region" aria-label={`${video.title} video player`} aria-busy={playbackLoading||waiting}>
    {(sourceUrl||authorization.streamUrl)&&<video ref={player} key={`${video.id}-${revision}`} controls={false} playsInline preload="metadata" poster={video.artwork||undefined} src={sourceUrl||authorization.streamUrl} onWaiting={()=>setWaiting(true)} onPlaying={()=>{setAutoplayBlocked(false);transport.playing();}} onTimeUpdate={()=>{if(!resumeDismissed&&resumePosition>1&&player.current.currentTime>=resumePosition)setResumeDismissed(true);}} onCanPlay={transport.canPlay} onSeeked={transport.seeked} onLoadedMetadata={()=>{setReady(true);transport.metadata();}} onError={transport.error} aria-label={video.title}/>}
    <PlayerControls key={video.id} player={player} mediaKey={`${video.id}-${revision}-${sourceUrl||authorization.streamUrl||'pending'}`} ready={ready} disabled={!!error||!!playbackFailure||playbackLoading||!(sourceUrl||authorization.streamUrl)} starting={waiting||playbackLoading} onSeekBy={transport.seekBy} onSeekTo={transport.seekTo}/>
    {resumePosition>1&&!resumeDismissed&&!error&&!playbackFailure&&<div className="resume-banner player-resume"><span>Continue from {duration(resumePosition)}?</span><button className="gold-button" disabled={playbackLoading||!(sourceUrl||authorization.streamUrl)} onClick={()=>{setResumeDismissed(true);void transport.startAt(resumePosition)?.catch(error=>{if(error.name==='NotAllowedError')setAutoplayBlocked(true);});}}>Resume</button><button className="text-button" aria-label="Dismiss resume suggestion" onClick={()=>setResumeDismissed(true)}>Dismiss</button></div>}
    {autoplayBlocked&&!error&&!playbackFailure&&<p className="player-control-notice" role="status">Your browser blocked automatic playback. Press Play to start.</p>}
    {(playbackLoading||waiting)&&!error&&!playbackFailure&&<div className="player-loading" role="status"><Icon name="loading" size={30} className="spin"/><span>Loading video…</span></div>}
    {(playbackFailure||error)&&<div className="player-error" role="alert"><Icon name="error" size={32}/><h2>Unable to play this video</h2><p>{playbackFailure||error}</p><button className="gold-button" onClick={()=>{setError('');if(playbackFailure)authorization.retry();else setRevision(n=>n+1);}}>Try again</button>{!playbackFailure&&<button className="text-button" onClick={retryWithoutCache}>Retry with device caching off</button>}</div>}
  </div>
  <div className="video-heading"><div><p className="eyebrow">YOUR VIDEO LIBRARY</p><h1>{video.title}</h1></div>{!sourceUrl&&<LikeButton video={video}/>}<button className={`nav-pill ${saved.includes(video.id)?'current':''}`} aria-pressed={saved.includes(video.id)} onClick={()=>onSave(video.id)}><Icon name="saved"/>{saved.includes(video.id)?'Saved':'Save'}</button></div>
  <div className="video-meta"><span>{formatOf(video)}</span><span>{fileSize(video.sizeBytes)}</span><span>Added {new Date(video.uploadedAt).toLocaleDateString()}</span>{duration(video.durationSeconds)&&<span>{duration(video.durationSeconds)}</span>}</div>
  {video.titleUnverified&&<p className="section-note">Title identified from the filename.</p>}<p className="description">{video.description||'No description is available for this video.'}</p><details className="file-details"><summary>File details</summary><p>{video.filename}</p><p>{video.mimeType||'Media type unavailable'}</p></details>{localError&&<p role="status">Playback progress couldn't be saved on this device.</p>}<Comments videoId={video.id}/>
  </div>;
}
