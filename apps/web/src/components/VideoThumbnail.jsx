import {useEffect,useRef,useState} from 'react';
import {Icon} from './Icons';
import {useAccount} from '../hooks/useAccount';

export function VideoThumbnail({video,landscape=false}){
  const account=useAccount(),membership=account.library?account.library.membership:account.membership,locked=video.accessType==='VIP'&&(!account.user||!membership||Date.parse(membership.expiresAt)<=Date.now());
  const container=useRef(null),[image,setImage]=useState(null);
  useEffect(()=>{
      setImage(null);
      if(video.artwork)return;
      const abort=new AbortController();let timer,objectURL,started=false;
      const load=async(attempt=0)=>{
        try{
          const response=await fetch(`/api/videos/${encodeURIComponent(video.id)}/thumbnail`,{signal:abort.signal,cache:'no-store'});
          if(response.status===202&&attempt<120){timer=setTimeout(()=>void load(attempt+1),Math.min(10000,3000+attempt*200));return;}
          if(!response.ok||response.headers.get('content-type')!=='image/jpeg')return;
          const bytes=await response.blob();if(abort.signal.aborted)return;
          objectURL=URL.createObjectURL(bytes);setImage(objectURL);
        }catch{/* Keep the existing fallback when streaming/extraction fails. */}
      };
      const observer=new IntersectionObserver(entries=>{
        if(!started&&entries.some(entry=>entry.isIntersecting)){started=true;observer.disconnect();void load();}
      },{rootMargin:'120px'});
      observer.observe(container.current);
      return()=>{abort.abort();clearTimeout(timer);observer.disconnect();if(objectURL)URL.revokeObjectURL(objectURL);};
  },[video.id,video.filename,video.sizeBytes,video.uploadedAt,video.artwork]);
  return <div ref={container} className={`video-thumbnail ${locked?'vip-locked':''}`}>
    {video.artwork||image?<img src={video.artwork||image} alt="" loading="lazy" onError={()=>setImage(null)}/>:
      <div className="missing-art"><Icon name="video" size={landscape?45:36}/><span>Habeshan <i>HUB</i></span><small>No preview available</small></div>}
  </div>;
}
