import {useLayoutEffect,useRef} from 'react';
import {createVideoTransport} from '../services/video-transport.mjs';

export function useVideoTransport(player,source,duration,revision,{setWaiting,setError,revalidate}){
 const transport=useRef(null),latest=useRef(null);latest.current={setWaiting,setError,revalidate};
 useLayoutEffect(()=>{
  if(!source||!player.current)return;
  const current=createVideoTransport({element:player.current,source,duration,onWaiting:value=>latest.current.setWaiting(value),onError:value=>latest.current.setError(value),revalidate:()=>latest.current.revalidate()});
  transport.current=current;
  const leave=()=>current.close();addEventListener('pagehide',leave);
  return()=>{removeEventListener('pagehide',leave);transport.current=null;current.close();};
 },[player,source,duration,revision]);
 return {seekBy:seconds=>transport.current?.seekBy(seconds),seekTo:seconds=>transport.current?.seekTo(seconds),startAt:seconds=>transport.current?.startAt(seconds),error:()=>transport.current?.error(),metadata:()=>transport.current?.metadata(),canPlay:()=>transport.current?.canPlay(),playing:()=>transport.current?.playing(),seeked:()=>transport.current?.seeked()};
}
