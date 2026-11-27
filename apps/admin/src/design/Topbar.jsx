// Layout/classes copied from the supplied dashboard; actions use Hub routes.
import React from 'react';
import {Search,Sun,Moon,Sparkles,Bell,Plus,ChevronRight} from 'lucide-react';
export default function Topbar({title,workspace='Habeshan HUB',onOpenCreate,onOpenSearch,onOpenAudit,atmosphericMode,setAtmosphericMode}){
 const toggleAtmospheric=()=>setAtmosphericMode(atmosphericMode==='cinematic'?'subtle':atmosphericMode==='subtle'?'minimal':'cinematic');
  return (
    <header className="reference-topbar shrink-0 relative z-10 flex items-center justify-between h-16 px-6 border-b border-white/[0.06] bg-[#171f29]/80 backdrop-blur-md">
      {/* Upper-left Breadcrumbs */}
      <nav className="flex items-center space-x-2 text-xs font-medium">
        {[workspace, title].map((crumb, idx, arr) => (
          <React.Fragment key={crumb}>
            <span className={idx === arr.length - 1 ? 'text-white font-semibold' : 'text-[#8e98a4]'}>
              {crumb}
            </span>
            {idx < arr.length - 1 && (
              <ChevronRight size={13} className="text-[#55606e]" />
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* Right Action Controls */}
      <div className="flex items-center space-x-3">
        {/* Search Input Trigger */}
        <button
          aria-label="Find an administration page" onClick={onOpenSearch}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] text-[#8e98a4] hover:text-white transition-all text-xs"
        >
          <Search size={14} className="text-[#a8b0b8]" />
          <span className="hidden md:inline">Find a page...</span>
          <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#6c7784] bg-white/[0.06] rounded border border-white/[0.08]">
            Ctrl K
          </kbd>
        </button>

        {/* Atmospheric / Theme Mode Toggle */}
        <button
          onClick={toggleAtmospheric}
          title={`Atmospheric backdrop: ${atmosphericMode} mode`}
          className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[#a8b0b8] hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          {atmosphericMode === 'cinematic' ? (
            <Sparkles size={16} className="text-[#f69b61]" />
          ) : atmosphericMode === 'subtle' ? (
            <Moon size={16} />
          ) : (
            <Sun size={16} />
          )}
        </button>

        {/* The reference bell opens the existing audit trail; no fake alerts. */}
        <button onClick={onOpenAudit} title="View audit logs" aria-label="View audit logs" className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[#a8b0b8] hover:text-white hover:bg-white/[0.06] transition-colors"><Bell size={16}/></button>

        {/* Orange + Create Button */}
        <button
          aria-label="Manage memberships" onClick={onOpenCreate}
          className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-button bg-[#f69b61] hover:bg-[#ffad68] text-[#171f29] font-bold text-xs shadow-glow-orange transition-all duration-150 transform hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus size={15} strokeWidth={2.5} />
          <span className="hidden sm:inline">Manage memberships</span>
        </button>
      </div>
    </header>
  );
}

