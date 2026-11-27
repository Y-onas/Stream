import React,{useEffect,useRef,useState} from 'react';
import {RefreshCw,X,ShieldAlert} from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import AtmosphericBackground from './AtmosphericBackground';
import NavigationSearch from './NavigationSearch';

// Workspace composition copied from the supplied App. Data and actions are
// injected by the existing, backend-approved administration application.
export default function DashboardFrame({admin,routes,base,path,title,onNavigate,onSignOut,onRefresh,onAccountSecurity,success,onDismiss,children}){
 const [collapsed,setCollapsed]=useState(()=>matchMedia('(max-width:767px)').matches),[mode,setMode]=useState('cinematic'),[search,setSearch]=useState(false),canvas=useRef(null);
 useEffect(()=>{const key=event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearch(value=>!value);}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[]);
 useEffect(()=>{setSearch(false);if(matchMedia('(max-width:767px)').matches)setCollapsed(true);canvas.current?.scrollTo({top:0});},[path]);
 return <div className="reference-shell flex h-screen w-full overflow-hidden bg-[#0b0f13] text-[#f4f3f1] font-sans" data-sidebar-expanded={!collapsed}>
  <AtmosphericBackground mode={mode}/>
  {!collapsed&&<button className="mobile-sidebar-scrim" aria-label="Close navigation" onClick={()=>setCollapsed(true)}/>}
  <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} activePage={path} setActivePage={onNavigate} admin={admin} routes={routes} base={base} onSignOut={onSignOut}/>
  <div className="reference-workspace flex flex-col flex-1 h-screen min-w-0 relative z-10 overflow-hidden">
   <Topbar title={title} onOpenSearch={()=>setSearch(true)} onOpenCreate={()=>onNavigate('/memberships')} onOpenAudit={()=>onNavigate('/audit-logs')} atmosphericMode={mode} setAtmosphericMode={setMode}/>
   <main ref={canvas} className="reference-canvas flex-1 overflow-y-auto px-4 sm:px-8 py-6 relative" id="admin-main">
    <div className="admin-content max-w-7xl mx-auto pb-12">
     <div className="page-heading flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div><p className="workspace-eyebrow">{admin.role==='OWNER'?'Owner workspace':'Administrator workspace'}</p><h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{title}</h1></div>
      <button className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-semibold text-white transition-colors" onClick={onRefresh} aria-label="Refresh current records"><RefreshCw size={14} className="text-[#f69b61]"/>Refresh</button>
     </div>
     {success&&<p className="admin-success" role="status">{success}<button aria-label="Dismiss confirmation" onClick={onDismiss}><X size={15}/></button></p>}
     {admin.role==='OWNER'&&!admin.mfaEnabled&&<p className="admin-security-note" role="status"><ShieldAlert size={16}/><span>Two-step verification is not enabled for your owner account.</span><button onClick={onAccountSecurity}>Manage account security</button></p>}
     <div key={path} className="page-transition dashboard-page">{children}</div>
    </div>
   </main>
  </div>
  <NavigationSearch isOpen={search} onClose={()=>setSearch(false)} onNavigate={onNavigate} routes={routes}/>
 </div>;
}
