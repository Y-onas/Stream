import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AccountProvider} from '../src/hooks/useAccount';
import {VideoPage} from '../src/pages/Video';
import '../src/styles/main.css';
export function mountPlayer(blob){
  const host=document.createElement('div');document.body.append(host);const url=URL.createObjectURL(blob);
  const video={id:'disposable-qa-clip',title:'Synthetic browser test clip',filename:blob.type.includes('mp4')?'test.mp4':'test.webm',mimeType:blob.type,sizeBytes:blob.size,uploadedAt:new Date().toISOString(),description:'Generated on this device solely to test browser controls. Not Telegram content.',durationSeconds:8};
  function Harness(){const [revision,setRevision]=useState(0),[saved,setSaved]=useState([]);return <><button onClick={()=>setRevision(n=>n+1)}>Reopen test player to check resume</button><VideoPage key={revision} video={video} sourceUrl={url} saved={saved} onSave={()=>setSaved(saved.length?[]:[video.id])}/></>;}
  createRoot(host).render(<AccountProvider><Harness/></AccountProvider>);
}
