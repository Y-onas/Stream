import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {Search as SearchIcon,X} from 'lucide-react';
export const AdminContext=createContext(null);
export const useAdmin=()=>useContext(AdminContext);
export const date=v=>v?new Date(v).toLocaleString():'—';
export const money=(amount,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(amount/100);
export const duration=v=>Number.isFinite(v)?`${Math.floor(v/3600)}h ${Math.floor(v%3600/60)}m ${Math.floor(v%60)}s`:'Unknown';
export function useRecords(endpoint,{refreshMs=0}={}){
 const {request,revision}=useAdmin(),[state,setState]=useState({loading:true});
 useEffect(()=>{
  const abort=new AbortController();let busy=false;setState({loading:true});
  async function refresh(){if(busy||abort.signal.aborted)return;busy=true;try{
   const signal=refreshMs?AbortSignal.any([abort.signal,AbortSignal.timeout(10000)]):abort.signal;
   const data=await request(endpoint,{signal});if(!abort.signal.aborted)setState({data,loading:false,updatedAt:new Date().toISOString()});
  }catch(error){if(!abort.signal.aborted)setState(old=>[401,403].includes(error.status)?{error:error.message,loading:false}:{...old,error:error.message,loading:false});}finally{busy=false;}}
  const visibleRefresh=()=>{if(!document.hidden)void refresh();};void refresh();
  const timer=refreshMs?setInterval(visibleRefresh,Math.max(15000,refreshMs)):null;
  if(refreshMs){addEventListener('focus',visibleRefresh);document.addEventListener('visibilitychange',visibleRefresh);}
  return()=>{abort.abort();clearInterval(timer);removeEventListener('focus',visibleRefresh);document.removeEventListener('visibilitychange',visibleRefresh);};
 },[endpoint,revision,refreshMs]);return state;
}
export function Status({state}){return state.loading?<p role="status">Loading records…</p>:state.error?<p className="admin-error" role="alert">{state.error}</p>:null;}
export function Table({columns,items,label}){return <div className="table-wrap rounded-card glass-card p-5 border border-white/[0.08]"><div className="table-scroll" role="region" aria-label={label} tabIndex={0}><table className="w-full text-left text-xs"><caption className="sr-only">{label}</caption><thead><tr className="border-b border-white/[0.06] text-[#8e98a4]">{columns.map(([name],i)=><th key={i} scope="col">{name}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.04]">{items.map((item,i)=><tr className="hover:bg-white/[0.02]" key={item.id||i}>{columns.map(([,render],j)=><td key={j}>{render(item)}</td>)}</tr>)}</tbody></table></div>{!items.length&&<p className="table-empty">No records match this view.</p>}</div>;}
export function Pager({data,offset,setOffset}){return <div className="admin-pagination"><span>{data.total} records</span><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous</button><button disabled={offset+data.items.length>=data.total} onClick={()=>setOffset(offset+25)}>Next</button></div>;}
export function Search({onSearch,placeholder='Search records',children}){const [q,setQ]=useState('');return <form className="admin-toolbar" onSubmit={e=>{e.preventDefault();onSearch(q);}}><label className="record-search flex items-center space-x-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]"><SearchIcon size={14} className="text-[#a8b0b8] shrink-0"/><input aria-label={placeholder} placeholder={placeholder} maxLength={100} value={q} onChange={e=>setQ(e.target.value)}/></label><button type="submit">Search</button>{children}</form>;}
export function Select({label,value,onChange,options}){return <label className="toolbar-select"><span>{label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(([id,text])=><option value={id} key={id}>{text}</option>)}</select></label>;}
export function Json({value}){return <pre className="audit-json">{JSON.stringify(value,null,2)}</pre>;}
export function Field({label,name,defaultValue='',type='text',required=true,...props}){return <label className="admin-field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue??''} required={required} {...props}/></label>;}
export function TextArea({label,name,defaultValue='',...props}){return <label className="admin-field"><span>{label}</span><textarea name={name} defaultValue={defaultValue??''} {...props}/></label>;}
export function Reason(){return <TextArea label="Reason / internal note" name="reason" required minLength={3} maxLength={4000}/>;}
export function Check({label,name,defaultChecked=false,onChange}){return <label className="verification-check"><input type="checkbox" name={name} defaultChecked={defaultChecked} onChange={onChange}/><span>{label}</span></label>;}
export function Editor({title,onClose,onSubmit,children,submitLabel='Save changes',footer}){const ref=useRef(null),[busy,setBusy]=useState(false),[error,setError]=useState('');useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);async function submit(e){e.preventDefault();const form=new FormData(e.currentTarget);if(e.nativeEvent.submitter?.value)form.set('action',e.nativeEvent.submitter.value);setError('');setBusy(true);try{await onSubmit(form);onClose();}catch(error){setError(error.message);}finally{setBusy(false);}}
 return <dialog className="admin-dialog glass-card" ref={ref} aria-labelledby="admin-dialog-title" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><div className="panel-heading"><div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#f69b61]"/><h2 id="admin-dialog-title">{title}</h2></div><button disabled={busy} onClick={onClose} aria-label="Close dialog"><X size={16}/></button></div><form onSubmit={submit}><fieldset disabled={busy}>{children}{error&&<p className="admin-error" role="alert">{error}</p>}<div className="review-actions"><button type="button" onClick={onClose}>Cancel</button>{footer||<button className="admin-button gold" type="submit">{busy?'Saving…':submitLabel}</button>}</div></fieldset></form></dialog>;
}
export function History({logs}){return <div className="record-history"><h3>Audit history</h3>{logs.length?logs.map(log=><details key={log.id}><summary>{date(log.createdAt)} · {log.action} · {log.adminId}</summary><p>{log.note}</p><Json value={{before:log.before,after:log.after}}/></details>):<p>No changes have been recorded.</p>}</div>;}
export const formString=(form,key)=>String(form.get(key)||'');
export const formNumber=(form,key)=>Number(form.get(key));
