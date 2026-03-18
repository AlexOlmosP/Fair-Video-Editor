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
      <div className="h-12 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4 gap-4 flex-shrink-0">
        {/* Logo / Brand */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center text-xs font-bold">
            VE
          </div>
          <span className="text-sm font-medium text-[var(--text-secondary)]">{projectName}</span>
        </div>

        <div className="w-px h-6 bg-zinc-700" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => useHistoryStore.getState().undo()}
            disabled={!hasPast}
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
            </svg>
          </button>
          <button
            onClick={() => useHistoryStore.getState().redo()}
            disabled={!hasFuture}
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
          className={`p-2 rounded transition-colors ${showProperties ? 'bg-zinc-700 text-white' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'}`}
          title="Toggle Properties Panel"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>

        {/* Export Button */}
        <button
          onClick={() => setShowExport(true)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
        >
          Export
        </button>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </>
  );
}
