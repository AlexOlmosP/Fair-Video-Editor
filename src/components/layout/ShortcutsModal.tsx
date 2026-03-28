'use client';

import React, { useEffect } from 'react';
import { SHORTCUT_CATEGORIES, getShortcutsByCategory, type ShortcutDef } from '@/lib/shortcuts';

interface ShortcutsModalProps {
  onClose: () => void;
}

function KeyBadge({ label }: { label: string }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 rounded-md text-[10px] font-semibold
                 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
      style={{ boxShadow: '0 1px 0 var(--border-color)' }}
    >
      {label}
    </kbd>
  );
}

function ShortcutRow({ def }: { def: ShortcutDef }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 px-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors">
      <div className="min-w-0">
        <span className="text-[12px] text-[var(--text-primary)]">{def.description}</span>
        {def.condition && (
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{def.condition}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {def.keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-[10px] text-[var(--text-muted)]">+</span>}
            <KeyBadge label={k} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const byCategory = getShortcutsByCategory();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-[1.25rem] w-[640px] max-h-[80vh] flex flex-col"
        style={{ boxShadow: 'var(--modal-shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-icon-press p-1 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — two-column grid of categories */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {SHORTCUT_CATEGORIES.map((cat) => {
              const defs = byCategory[cat];
              if (!defs || defs.length === 0) return null;
              return (
                <div key={cat}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5 px-2">
                    {cat}
                  </h3>
                  <div className="space-y-0.5">
                    {defs.map((def, i) => (
                      <ShortcutRow key={i} def={def} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-[var(--glass-border)] flex-shrink-0">
          <p className="text-[10px] text-[var(--text-muted)] text-center">
            Press <KeyBadge label="?" /> or <KeyBadge label="Esc" /> to close
          </p>
        </div>
      </div>
    </div>
  );
}
