'use client';

import React, { useState } from 'react';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useProjectStore } from '@/store/useProjectStore';
import { ExportModal } from '../export/ExportModal';

interface ToolbarProps {
  onToggleProperties: () => void;
  showProperties: boolean;
}

export function Toolbar({ onToggleProperties, showProperties }: ToolbarProps) {
  const hasPast = useHistoryStore((s) => s.past.length > 0);
  const hasFuture = useHistoryStore((s) => s.future.length > 0);
  const projectName = useProjectStore((s) => s.settings.name);
  const [showExport, setShowExport] = useState(false);

  return (
    <>
      <div className="h-14 glass-panel flex items-center px-5 gap-4 flex-shrink-0 border-b border-[var(--glass-border)]">
        {/* Logo / Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white tracking-tight"
               style={{ boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3), inset 0 1px 1px rgba(255,255,255,0.2)' }}>
            VE
          </div>
          <span className="text-[13px] font-medium text-[var(--text-primary)] tracking-tight">{projectName}</span>
        </div>

        <div className="w-px h-5 bg-[var(--border-color)]" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => useHistoryStore.getState().undo()}
            disabled={!hasPast}
            className="p-2 rounded-xl hover:bg-[var(--hover-bg)] disabled:opacity-20 disabled:cursor-not-allowed btn-icon-press text-[var(--text-secondary)]"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
            </svg>
          </button>
          <button
            onClick={() => useHistoryStore.getState().redo()}
            disabled={!hasFuture}
            className="p-2 rounded-xl hover:bg-[var(--hover-bg)] disabled:opacity-20 disabled:cursor-not-allowed btn-icon-press text-[var(--text-secondary)]"
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
            </svg>
          </button>
        </div>

        <div className="flex-1" />

        {/* Toggle Properties Panel */}
        <button
          onClick={onToggleProperties}
          className={`p-2 rounded-xl btn-icon-press ${showProperties ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'hover:bg-[var(--hover-bg)] text-[var(--text-muted)]'}`}
          title="Toggle Properties Panel"
        >
          <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>

        {/* Export Button — pill with trailing icon */}
        <button
          onClick={() => setShowExport(true)}
          className="pl-5 pr-3 py-2 bg-[var(--accent-export)] hover:bg-emerald-400 rounded-full text-[13px] font-semibold text-white btn-press flex items-center gap-2.5 group"
          style={{ boxShadow: '0 2px 12px rgba(16, 185, 129, 0.3), inset 0 1px 1px rgba(255,255,255,0.15)' }}
        >
          Export
          <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </span>
        </button>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </>
  );
}
