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
      <div className="h-14 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4 gap-4 flex-shrink-0" style={{ boxShadow: 'var(--panel-shadow)' }}>
        {/* Logo / Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-xs font-bold text-white shadow-md">
            VE
          </div>
          <span className="text-sm font-medium text-[var(--text-secondary)]">{projectName}</span>
        </div>

        <div className="w-px h-6 bg-[var(--border-color)]" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => useHistoryStore.getState().undo()}
            disabled={!hasPast}
            className="p-2 rounded-lg hover:bg-[var(--hover-bg)] disabled:opacity-30 disabled:cursor-not-allowed btn-press"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
            </svg>
          </button>
          <button
            onClick={() => useHistoryStore.getState().redo()}
            disabled={!hasFuture}
            className="p-2 rounded-lg hover:bg-[var(--hover-bg)] disabled:opacity-30 disabled:cursor-not-allowed btn-press"
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
            </svg>
          </button>
        </div>

        <div className="flex-1" />

        {/* Toggle Properties Panel */}
        <button
          onClick={onToggleProperties}
          className={`p-2 rounded-lg btn-press ${showProperties ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'hover:bg-[var(--hover-bg)] text-[var(--text-secondary)]'}`}
          title="Toggle Properties Panel"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>

        {/* Export Button */}
        <button
          onClick={() => setShowExport(true)}
          className="px-5 py-2 bg-[var(--accent-export)] hover:bg-emerald-400 rounded-xl text-sm font-semibold text-white btn-press flex items-center gap-2"
          style={{ boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Export
        </button>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </>
  );
}
