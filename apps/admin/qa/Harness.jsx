// Development-only integration harness. Excluded from normal production builds/images.
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AdminContext} from '../src/AdminUI';
import {Videos,Users,Memberships,Requests,Comments,Audit,Administrators} from '../src/Management';
import {Settings} from '../src/Settings';
import {Analytics} from '../src/Analytics';
import '../src/styles/main.css';
const views={Overview:()=> <Analytics overview/>,Videos,Users,Requests,Memberships,Comments,Analytics,Settings,Administrators,Audit};
function Harness(){const [page,setPage]=useState('Overview'),[revision,setRevision]=useState(0),[success,setSuccess]=useState(''),[admin,setAdmin]=useState(null);async function request(path,{json,...options}={}){const r=await fetch('/api/admin'+path,{...options,...(json?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(json)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message);return data;}useEffect(()=>{request('/me').then(setAdmin);},[]);const View=views[page];return <><p style={{margin:0,padding:10,textAlign:'center',color:'#ebbd66',font:'12px monospace'}}>ISOLATED DATABASE TEST · temporary records · no actual payments · no production authentication bypass</p>{admin?<AdminContext.Provider value={{request,admin,revision,changed:message=>{setSuccess(message);setRevision(n=>n+1);}}}><div className="admin-shell"><aside><a className="brand">Habeshan <i>HUB</i><small>ADMINISTRATION TEST</small></a><nav aria-label="Admin navigation">{Object.keys(views).map(v=><a key={v} href={'#'+v} aria-current={v===page?'page':undefined} onClick={e=>{e.preventDefault();setPage(v);setSuccess('');}}>{v}</a>)}</nav><p>Temporary verified test owner</p></aside><main><span className="tag">ADMINISTRATION · ISOLATED ACCEPTANCE CHECK</span><h1>{page}</h1>{success&&<p className="admin-success" role="status">{success}</p>}<View key={page}/></main></div></AdminContext.Provider>:<p role="status">Checking isolated administrator identity…</p>}</>;}
createRoot(document.getElementById('root')).render(<Harness/>);
