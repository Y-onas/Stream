import {useEffect,useState} from 'react';
// Keep the origin so a video's return link restores Home, Search or a collection.
export function navigate(path){history.pushState({from:location.pathname},'',path);dispatchEvent(new PopStateEvent('popstate'));scrollTo({top:0,behavior:'instant'});}
export function useRoute(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const update=()=>setPath(location.pathname);addEventListener('popstate',update);return()=>removeEventListener('popstate',update);},[]);return path;}
export function Link({to,children,...props}){return <a href={to} {...props} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate(to);}}}>{children}</a>;}
