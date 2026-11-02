import {useEffect,useState} from 'react';
export function navigate(path){history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));scrollTo({top:0,behavior:'instant'});}
export function useRoute(){const [path,setPath]=useState(location.pathname);useEffect(()=>{const update=()=>setPath(location.pathname);addEventListener('popstate',update);return()=>removeEventListener('popstate',update);},[]);return path;}
export function Link({to,children,...props}){return <a href={to} {...props} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate(to);}}}>{children}</a>;}
