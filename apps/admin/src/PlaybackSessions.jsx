import React,{useState} from 'react';
import {useAdmin,useRecords,Status,Table,Pager,Editor,Reason,date,formString} from './AdminUI';

export function PlaybackSessions(){
 const {request,changed}=useAdmin(),[offset,setOffset]=useState(0),[selected,setSelected]=useState(null),state=useRecords(`/playback-sessions?offset=${offset}&limit=25`,{refreshMs:30000});
 return <><p>Reported playback activity and recovery reservations. Updates every 30 seconds while this page is visible. Paused sessions retain their slot for up to ten minutes.</p>{state.updatedAt&&<p>Last updated {date(state.updatedAt)}</p>}<Status state={state}/>{state.data&&<><Table label="Active playback sessions" items={state.data.items} columns={[
  ['Account',p=>p.user?.username||'Anonymous'],['Video',p=>p.video.titleOverride||p.video.title],['Access',p=>p.accessType],['Browser / device',p=>p.clientLabel||'Not reported'],['State',p=>(p.reportedState||'Awaiting player')+(p.heartbeatStatus==='DELAYED'?' · heartbeat delayed':'')],['Started',p=>date(p.startedAt)],['Last heartbeat',p=>date(p.lastHeartbeatAt)],['Reservation deadline',p=>date(p.reservedUntil)],['Error',p=>p.lastError||'—'],['Action',p=><button onClick={()=>setSelected(p)}>Terminate</button>]
 ]}/><Pager data={state.data} offset={offset} setOffset={setOffset}/></>}{selected&&<Editor title="Terminate playback session" submitLabel="Terminate session" onClose={()=>setSelected(null)} onSubmit={async form=>{await request(`/playback-sessions/${selected.id}/terminate`,{json:{reason:formString(form,'reason')}});changed('Playback terminated. Account and membership are unchanged.');}}><p>{selected.video.titleOverride||selected.video.title} · {selected.user?.username||'Anonymous'}</p><p>Further stream requests will be denied. Already-buffered video cannot be recalled.</p><Reason/></Editor>}</>;
}

export function SecurityEvents(){
 const [offset,setOffset]=useState(0),state=useRecords(`/security-events?offset=${offset}&limit=25`,{refreshMs:30000});
 return <><p>Aggregated security signals, limited to one record per event type per minute and retained for seven days. Counts may be sampled during heavy traffic.</p><Status state={state}/>{state.data&&<><Table label="Security events" items={state.data.items} columns={[
  ['Event',e=>e.kind],['Count',e=>e.count],['First seen',e=>date(e.firstSeenAt)],['Last seen',e=>date(e.lastSeenAt)]
 ]}/><Pager data={state.data} offset={offset} setOffset={setOffset}/></>}</>;
}
