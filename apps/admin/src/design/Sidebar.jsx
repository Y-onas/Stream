import React from 'react';
import { 
  Home, 
  Film, 
  BarChart3, 
  Users, 
  Wallet, 
  ShoppingBag, 
  MessageSquare, 
  Settings, 
  HelpCircle, 
  ChevronLeft, 
  ChevronRight,
  LogOut
} from 'lucide-react';
// Copied from the supplied dashboard; identity/routes come only from Habeshan HUB.

export default function Sidebar({ 
  collapsed, 
  setCollapsed, 
  activePage, 
  setActivePage, admin, routes, base, onSignOut 
}) {
  const icons={ '/':Home, '/videos':Film, '/users':Users, '/comments':MessageSquare, '/analytics':BarChart3, '/subscription-requests':Wallet, '/memberships':ShoppingBag, '/playback-sessions':Film, '/security-events':HelpCircle, '/operations':BarChart3, '/administrators':Users, '/audit-logs':MessageSquare, '/settings':Settings };
  const groups=[['MANAGE',['/','/videos','/users','/comments']],['MEMBERSHIPS',['/subscription-requests','/memberships']],['PLATFORM',['/analytics','/playback-sessions','/security-events','/operations','/administrators','/audit-logs']]];
  const item=([id,label])=>({id,label,icon:icons[id]||Settings});
  const sections=groups.map(([title,paths])=>({title,items:routes.filter(([id])=>paths.includes(id)).map(item)})).filter(section=>section.items.length);
  const footerNav=routes.filter(([id])=>id==='/settings').map(item);
  const creatorProfile={name:admin.name,workspace:admin.email};

  return (
    <aside 
      className={`reference-sidebar relative z-20 flex flex-col h-screen shrink-0 transition-all duration-300 ease-in-out border-r border-white/[0.08] bg-[#141b24]/90 backdrop-blur-xl ${
        collapsed ? 'w-[72px]' : 'w-[250px]'
      }`}
    >
      {/* Edge Toggle Pill (Always clean, never overlaps the logo) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-5 z-30 flex items-center justify-center w-6 h-6 rounded-full bg-[#1c2531] border border-white/20 text-[#a8b0b8] hover:text-white hover:bg-[#222a34] hover:border-[#f69b61] shadow-lg transition-all duration-150 hover:scale-110"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <ChevronRight size={13} strokeWidth={2.5} />
        ) : (
          <ChevronLeft size={13} strokeWidth={2.5} />
        )}
      </button>

      {/* Brand Header */}
      {collapsed ? (
        /* Collapsed Header: Pristine, centered S Logo with zero overlap */
        <div className="flex items-center justify-center h-16 w-full border-b border-white/[0.06]">
          <a href={base+'/'}
            onClick={event => {
              if(event.ctrlKey||event.metaKey||event.shiftKey||event.button!==0)return;
              event.preventDefault();
              setActivePage('/');
              setCollapsed(false);
            }}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#f69b61] shadow-glow-orange cursor-pointer transition-transform hover:scale-105 active:scale-95 group relative"
            title="Habeshan HUB • Click to expand"
          >
            <span className="font-extrabold text-[#171f29] text-xl leading-none tracking-tight select-none">H</span>
          </a>
        </div>
      ) : (
        /* Expanded Header: Logo + Brand + Workspace + Collapse Button */
        <div className="flex items-center justify-between h-16 px-4 border-b border-white/[0.06]">
          <a href={base+'/'}
            className="flex items-center space-x-3 min-w-0 cursor-pointer"
            onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.button!==0)return;event.preventDefault();setActivePage('/');}}
          >
            {/* Logo Badge */}
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#f69b61] shadow-glow-orange shrink-0 transition-transform hover:scale-105">
              <span className="font-extrabold text-[#171f29] text-xl leading-none tracking-tight select-none">H</span>
            </div>

            {/* Brand Name & Workspace */}
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-white text-[15px] tracking-tight leading-tight truncate">
                Habeshan HUB
              </span>
              <span className="text-[11px] text-[#a8b0b8] truncate font-medium">
                {creatorProfile.workspace}
              </span>
            </div>
          </a>

          {/* Header Collapse Button */}
          <button
            onClick={() => setCollapsed(true)}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#a8b0b8] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
            title="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      )}

      {/* Main Nav Sections */}
      <div className={`flex-1 overflow-y-auto py-4 space-y-6 scrollbar-none ${collapsed ? 'px-2' : 'px-3'}`}>
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] font-semibold tracking-wider text-[#6c7784] uppercase">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <a href={base+item.id} aria-current={activePage===item.id?"page":undefined} title={collapsed?item.label:undefined}
                  key={item.id}
                  onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.button!==0)return;event.preventDefault();setActivePage(item.id);}}
                  className={`group relative flex items-center transition-all duration-150 ${
                    collapsed
                      ? 'w-11 h-10 mx-auto justify-center rounded-xl'
                      : 'w-full px-3 py-2 space-x-3 rounded-xl text-sm font-medium'
                  } ${
                    isActive 
                      ? 'bg-[#f69b61] text-[#141b24] font-semibold shadow-glow-orange' 
                      : 'text-[#a8b0b8] hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon 
                    size={18} 
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#141b24]' : 'text-[#8e98a4] group-hover:text-white'
                    }`} 
                  />
                  {!collapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                  {isActive && !collapsed && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#141b24]" />
                  )}

                  {/* Floating tooltip when sidebar is collapsed */}
                  {collapsed && (
                    <div className="absolute left-full ml-3 px-2.5 py-1 rounded-lg bg-[#1c2531] text-white text-xs font-semibold whitespace-nowrap shadow-xl border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                      {item.label}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer Nav & Profile Switcher */}
      <div className={`border-t border-white/[0.06] space-y-2 ${collapsed ? 'p-2' : 'p-3'}`}>
        {/* Settings & Help */}
        <div className="space-y-1">
          {footerNav.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <a href={base+item.id} aria-current={activePage===item.id?"page":undefined} title={collapsed?item.label:undefined}
                key={item.id}
                onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.button!==0)return;event.preventDefault();setActivePage(item.id);}}
                className={`group relative flex items-center transition-colors ${
                  collapsed
                    ? 'w-11 h-10 mx-auto justify-center rounded-xl'
                    : 'w-full px-3 py-2 space-x-3 rounded-xl text-sm font-medium'
                } ${
                  isActive 
                    ? 'bg-[#f69b61] text-[#141b24] font-semibold' 
                    : 'text-[#a8b0b8] hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}

                {/* Floating tooltip */}
                {collapsed && (
                  <div className="absolute left-full ml-3 px-2.5 py-1 rounded-lg bg-[#1c2531] text-white text-xs font-semibold whitespace-nowrap shadow-xl border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                    {item.label}
                  </div>
                )}
              </a>
            );
          })}
        </div>

        {/* Profile Card / Workspace Switcher */}
        <div className={`pt-2 flex items-center rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer ${
          collapsed ? 'justify-center p-1' : 'justify-between p-1.5'
        }`}>
          <div className="flex items-center space-x-2.5 min-w-0">
            <div aria-hidden="true" className="w-8 h-8 rounded-full ring-2 ring-white/10 shrink-0 flex items-center justify-center bg-[#f69b61]/20 text-[#f69b61] text-xs font-bold">{admin.name?.slice(0,1).toUpperCase()||"H"}</div>
            {!collapsed && (
              <div className="flex flex-col min-w-0 leading-tight">
                <span className="text-xs font-semibold text-white truncate">
                  {creatorProfile.name}
                </span>
                <span className="text-[10px] text-[#8e98a4] truncate">
                  {creatorProfile.workspace}
                </span>
              </div>
            )}
          </div>
          {!collapsed && (
            <button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="text-[#8e98a4] hover:text-white p-1">
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>
    {collapsed&&<button onClick={onSignOut} aria-label="Sign out" title="Sign out" className="mx-auto mb-3 text-[#8e98a4] hover:text-white p-2"><LogOut size={16}/></button>}
    </aside>
  );
}
