import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Home, BarChart3, Wallet, ShoppingBag, Film, ArrowRight } from 'lucide-react';

export default function SearchModal({ isOpen, onClose, onNavigate, routes }) {
  const [query, setQuery] = useState('');

  const dialog=useRef(null);
  useEffect(()=>{if(!isOpen)return;const previous=document.activeElement;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus();};},[isOpen]);
  const items=routes.map(([page,title])=>({page,title,category:'Administration',icon:page==='/'?Home:page==='/analytics'?BarChart3:page==='/memberships'?Wallet:Film}));

  const filtered = items.filter(i => 
    i.title.toLowerCase().includes(query.toLowerCase()) ||
    i.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // Toggle or open handled by parent
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <dialog ref={dialog} className="reference-search" aria-label="Find an administration page" onCancel={event=>{event.preventDefault();onClose();}}>
      <div className="relative w-full max-w-xl rounded-2xl glass-card border border-white/[0.12] p-4 shadow-2xl">
        <div className="flex items-center space-x-3 px-3 py-2 bg-white/[0.04] rounded-xl border border-white/[0.08]">
          <Search size={18} className="text-[#f69b61]" />
          <input
            autoFocus
            onKeyDown={event=>{if(event.key==='Enter'&&filtered[0]){onNavigate(filtered[0].page);onClose();}}}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find videos, users, memberships, settings..."
            className="w-full bg-transparent text-sm text-white placeholder-[#6c7784] outline-none"
          />
          <button
            onClick={onClose}
            aria-label="Close page search"
            className="text-[#8e98a4] hover:text-white p-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 space-y-1 max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#8e98a4]">No results found for "{query}"</div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button type="button"
                  key={idx}
                  onClick={() => {
                    onNavigate(item.page);
                    onClose();
                  }}
                  className="w-full text-left flex items-center justify-between p-2.5 rounded-xl hover:bg-white/[0.06] cursor-pointer group transition-colors text-xs"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-white/[0.04] text-[#f69b61] group-hover:bg-[#f69b61] group-hover:text-[#171f29] transition-colors">
                      <Icon size={14} />
                    </div>
                    <div>
                      <span className="font-semibold text-white group-hover:text-[#f69b61] transition-colors">
                        {item.title}
                      </span>
                      <span className="text-[10px] text-[#6c7784] block">{item.category}</span>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-[#6c7784] group-hover:text-white transition-colors" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </dialog>
  );
}

