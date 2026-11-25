import {useEffect,useLayoutEffect,useId,useRef,useState} from 'react';
import {Play,Pause,RotateCcw,RotateCw,Volume2,VolumeX,Settings,Maximize,Minimize,ChevronLeft,ChevronRight,Check,X} from 'lucide-react';
import {PLAYBACK_RATES,setPlaybackSpeed,setSoundEnabled,originalQuality,playerTime} from '../services/player-preferences.mjs';

export function PlayerControls({player,mediaKey,ready,disabled,starting=false,onSeekBy,onSeekTo}){
 const [media,setMedia]=useState({paused:true,position:0,duration:0,buffered:0,volume:1,sound:true,rate:1,quality:'Original stream'}),[visible,setVisible]=useState(true),[settings,setSettings]=useState(null),[fullscreen,setFullscreen]=useState(false),[notice,setNotice]=useState('');
 const prefs=useRef({rate:1,muted:false,volume:1,lastVolume:1}),pendingSeek=useRef(null),hideTimer=useRef(null),settingsRef=useRef(null),trigger=useRef(null),interacting=useRef(false),latest=useRef(null),panelId=useId();
 latest.current={onSeekBy,onSeekTo,disabled,ready,settings};
 function reveal(){setVisible(true);clearTimeout(hideTimer.current);hideTimer.current=setTimeout(()=>{const el=player.current,frame=el?.closest('.player-frame');if(el&&!el.paused&&!latest.current.settings&&!interacting.current&&!frame?.matches(':focus-visible')&&!frame?.querySelector(':focus-visible'))setVisible(false);},3000);}
 function closeSettings(restore=true){setSettings(null);if(restore)trigger.current?.focus();reveal();}
 // A user gesture must be allowed to start loading even before metadata exists.
 // Only seeking needs a known duration; gating Play on it can strand a browser
 // that deferred preload, especially on a slow source or a mobile connection.
 function togglePlay(){const el=player.current;if(!el||latest.current.disabled)return;if(el.paused){void el.play().then(()=>setNotice('')).catch(error=>{if(error.name!=='AbortError')setNotice('Press Play to start this video.');});}else el.pause();reveal();}
 function showSeek(target){if(Number.isFinite(target)){pendingSeek.current=target;setMedia(old=>({...old,position:target}));}reveal();}
 function seekBy(seconds){if(latest.current.disabled||!latest.current.ready)return;showSeek(latest.current.onSeekBy(seconds));}
 function sound(enabled){const el=player.current;if(!el)return;setSoundEnabled(el,enabled,prefs.current.lastVolume);prefs.current.muted=el.muted;prefs.current.volume=el.volume;reveal();}
 function speed(rate){const el=player.current;if(!el)return;try{if(setPlaybackSpeed(el,rate)){prefs.current.rate=rate;setNotice('');setSettings('root');}}catch{setNotice('This browser could not apply that playback speed.');}}
 async function toggleFullscreen(){const frame=player.current?.closest('.player-frame'),el=player.current;if(!frame)return;try{if(document.fullscreenElement)await document.exitFullscreen();else if(frame.requestFullscreen)await frame.requestFullscreen();else if(el.webkitEnterFullscreen)el.webkitEnterFullscreen();else setNotice('Fullscreen is unavailable in this browser.');}catch{setNotice('Fullscreen could not open. Try the fullscreen button again.');}reveal();}
 useLayoutEffect(()=>{
  const el=player.current,frame=el?.closest('.player-frame');if(!el||!frame)return;
  pendingSeek.current=null;
  const update=()=>{let buffered=0;for(let i=0;i<el.buffered.length;i++)if(el.buffered.start(i)<=el.currentTime+.25)buffered=Math.max(buffered,el.buffered.end(i));setMedia({paused:el.paused||el.ended,position:pendingSeek.current??(el.currentTime||0),duration:Number.isFinite(el.duration)?el.duration:0,buffered,volume:el.volume,sound:!el.muted&&el.volume>0,rate:el.playbackRate,quality:originalQuality(el).label});};
  const metadata=()=>{try{setPlaybackSpeed(el,prefs.current.rate);if(el.volume!==prefs.current.volume)el.volume=prefs.current.volume;if(el.muted!==prefs.current.muted)el.muted=prefs.current.muted;}catch{}update();};
  const audio=()=>{prefs.current.volume=el.volume;prefs.current.muted=el.muted;if(el.volume>0)prefs.current.lastVolume=el.volume;update();};
  const rate=()=>{prefs.current.rate=el.playbackRate;update();};
  const playing=()=>{update();reveal();},paused=()=>{update();setVisible(true);clearTimeout(hideTimer.current);};
  const seeked=()=>{if(pendingSeek.current!==null&&Math.abs(el.currentTime-pendingSeek.current)<.25)pendingSeek.current=null;update();};
  const events={loadedmetadata:metadata,durationchange:update,timeupdate:update,progress:update,seeking:update,seeked,play:playing,playing, pause:paused,ended:paused,volumechange:audio,ratechange:rate,resize:update};
  for(const [name,fn] of Object.entries(events))el.addEventListener(name,fn);
  const key=event=>{
   if(event.key==='Escape'&&latest.current.settings){event.preventDefault();closeSettings();return;}
   if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('button,input,select,textarea,[role=dialog]'))return;
   const action=event.key.toLowerCase();if([' ','k','arrowleft','j','arrowright','l','m','f','arrowup','arrowdown'].includes(action))event.preventDefault();else return;
   if(action===' '||action==='k')togglePlay();else if(action==='arrowleft'||action==='j')seekBy(-10);else if(action==='arrowright'||action==='l')seekBy(10);else if(action==='m')sound(el.muted||el.volume===0);else if(action==='f')void toggleFullscreen();else{el.volume=Math.max(0,Math.min(1,el.volume+(action==='arrowup'?0.05:-0.05)));if(el.volume>0)el.muted=false;reveal();}
  };
  const clickVideo=()=>{togglePlay();frame.focus({preventScroll:true});};
  const fs=()=>setFullscreen(document.fullscreenElement===frame);
  frame.addEventListener('keydown',key);frame.addEventListener('pointermove',reveal);frame.addEventListener('pointerdown',reveal);frame.addEventListener('focusin',reveal);el.addEventListener('click',clickVideo);document.addEventListener('fullscreenchange',fs);
  metadata();fs();el.controls=false;
  return()=>{for(const [name,fn] of Object.entries(events))el.removeEventListener(name,fn);frame.removeEventListener('keydown',key);frame.removeEventListener('pointermove',reveal);frame.removeEventListener('pointerdown',reveal);frame.removeEventListener('focusin',reveal);el.removeEventListener('click',clickVideo);document.removeEventListener('fullscreenchange',fs);clearTimeout(hideTimer.current);el.controls=true;};
 },[mediaKey]);
 useEffect(()=>{
  if(!settings)return;
  settingsRef.current?.querySelector('button')?.focus();
  const outside=event=>{if(!settingsRef.current?.contains(event.target)&&!trigger.current?.contains(event.target))closeSettings(false);};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[settings]);
 const inactive=disabled||!ready,position=Math.min(media.duration,Math.max(0,media.position)),played=media.duration?position/media.duration*100:0,buffered=media.duration?media.buffered/media.duration*100:0;
 function radioKey(event){if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const rows=[...event.currentTarget.parentElement.querySelectorAll('[role=menuitemradio]')],i=rows.indexOf(event.currentTarget),next=event.key==='Home'?0:event.key==='End'?rows.length-1:(i+(event.key==='ArrowDown'?1:rows.length-1))%rows.length;rows[next]?.focus();}
 return <>
  {media.paused&&!disabled&&!settings&&!starting&&<button className="player-center-play" aria-label="Play video" onClick={togglePlay}><Play size={32} fill="currentColor"/></button>}
  <div className={`player-controls ${visible||media.paused||settings||starting?'is-visible':''}`} onPointerEnter={()=>{interacting.current=true;reveal();}} onPointerLeave={()=>{interacting.current=false;reveal();}}>
   <div className="player-timeline"><input aria-label="Seek video" aria-valuetext={`${playerTime(position)} of ${playerTime(media.duration)}`} type="range" min="0" max={Math.max(0,media.duration)} step=".1" value={position} disabled={inactive||!media.duration} onChange={event=>showSeek(latest.current.onSeekTo(Number(event.target.value)))} style={{'--played':`${played}%`,'--buffered':`${buffered}%`}}/></div>
   <div className="player-control-row">
    <button className="player-control" aria-label={media.paused?'Play':'Pause'} title={media.paused?'Play (Space)':'Pause (Space)'} disabled={disabled} onClick={togglePlay}>{media.paused?<Play size={23} fill="currentColor"/>:<Pause size={23} fill="currentColor"/>}</button>
    <button className="player-control player-skip" data-seek="back" aria-label="Rewind 10 seconds" title="Rewind 10 seconds (←)" disabled={inactive} onClick={()=>seekBy(-10)}><RotateCcw size={27}/><span>10</span></button>
    <button className="player-control player-skip" data-seek="forward" aria-label="Forward 10 seconds" title="Forward 10 seconds (→)" disabled={inactive} onClick={()=>seekBy(10)}><RotateCw size={27}/><span>10</span></button>
    <div className="player-volume"><button className="player-control" aria-label={media.sound?'Mute sound':'Turn sound on'} title="Sound (M)" disabled={disabled} onClick={()=>sound(!media.sound)}>{media.sound?<Volume2 size={22}/>:<VolumeX size={22}/>}</button><input aria-label="Volume" type="range" min="0" max="1" step=".05" value={media.sound?media.volume:0} disabled={disabled} onChange={event=>{const el=player.current;if(!el)return;el.volume=Number(event.target.value);el.muted=el.volume===0;reveal();}}/></div>
    <span className="player-time" aria-live="off">{playerTime(position)}<span className="player-total-time"> / {playerTime(media.duration)}</span></span>
    <div className="player-control-spacer"/>
    <button ref={trigger} className={`player-control ${settings?'selected':''}`} aria-label="Player settings" title="Settings" aria-expanded={!!settings} aria-controls={panelId} disabled={disabled} onClick={()=>{setSettings(value=>value?null:'root');reveal();}}><Settings size={22}/>{media.rate!==1&&<span className="player-speed-badge">{media.rate}×</span>}</button>
    <button className="player-control" aria-label={fullscreen?'Exit fullscreen':'Enter fullscreen'} title="Fullscreen (F)" disabled={disabled} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize size={22}/>:<Maximize size={22}/>}</button>
   </div>
  </div>
  {settings&&<div id={panelId} ref={settingsRef} className="player-settings" role="dialog" aria-label="Player settings"><header>{settings!=='root'&&<button className="player-control" aria-label="Back to player settings" onClick={()=>setSettings('root')}><ChevronLeft size={19}/></button>}<strong>{settings==='speed'?'Playback speed':settings==='quality'?'Video quality':'Settings'}</strong><button className="player-control" aria-label="Close player settings" onClick={()=>closeSettings()}><X size={18}/></button></header><div className="player-settings-content">
   {settings==='root'?<><button className="player-setting-row" onClick={()=>setSettings('speed')}><span>Playback speed</span><span>{media.rate===1?'Normal':`${media.rate}×`}<ChevronRight size={16}/></span></button><button className="player-setting-row" onClick={()=>setSettings('quality')}><span>Quality</span><span>{media.quality}<ChevronRight size={16}/></span></button><button className="player-setting-row" role="switch" aria-label="Player sound" aria-checked={media.sound} onClick={()=>sound(!media.sound)}><span className="player-sound-label">{media.sound?<Volume2 size={17}/>:<VolumeX size={17}/>}Sound</span><span>{media.sound?'On':'Off'}<i className={`player-switch ${media.sound?'on':''}`} aria-hidden="true"/></span></button></>:settings==='speed'?<div role="menu" aria-label="Playback speed">{PLAYBACK_RATES.map(rate=><button key={rate} className="player-setting-row player-setting-option" role="menuitemradio" aria-checked={media.rate===rate} onKeyDown={radioKey} onClick={()=>speed(rate)}><span>{rate===1?'1× · Normal':`${rate}×`}</span>{media.rate===rate&&<Check size={17}/>}</button>)}</div>:<div role="menu" aria-label="Video quality"><button className="player-setting-row player-setting-option" role="menuitemradio" aria-checked="true" onClick={()=>setSettings('root')}><span>{media.quality}</span><Check size={17}/></button><p className="player-quality-note">This video is available in its original quality only.</p></div>}
  </div></div>}
  {notice&&<p className="player-control-notice" role="status">{notice}</p>}
 </>;
}
