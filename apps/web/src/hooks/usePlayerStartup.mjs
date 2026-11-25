import {useEffect,useRef} from 'react';
import {createPlaybackStarter} from '../services/player-startup.mjs';

export function usePlayerStartup(player,source,revision,options){
 const starter=useRef(null),latest=useRef(options);latest.current=options;
 if(!starter.current)starter.current=createPlaybackStarter();
 useEffect(()=>{
  const element=player.current;if(!element||!source)return;
  let closed=false;
  const pending=starter.current(element,source,()=>{
   const position=latest.current.position();
   latest.current.onStarting(position);
   return latest.current.start(position);
  });
  void pending.then(()=>{if(!closed)latest.current.onStarted();}).catch(error=>{
   if(closed)return;
   // Never silently mute or bypass browser policy. Only an actual policy denial
   // needs a Play prompt; metadata/buffering does not require another click.
   if(error.name==='NotAllowedError')latest.current.onBlocked();
   else if(error.name==='AbortError')latest.current.onStopped();
   // Source/codec errors stay with the existing transport's recovery handler.
  });
  return()=>{closed=true;};
 },[player,source,revision]);
}
