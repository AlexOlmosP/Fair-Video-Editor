'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useProjectStore } from '@/store/useProjectStore';
import { ExportModal } from '../export/ExportModal';
import { ShortcutsModal } from './ShortcutsModal';
import { saveProject, loadProject, listProjects, deleteProject, type ProjectListItem } from '@/lib/projectStorage';
import { ASPECT_RATIO_PRESETS, LAYOUT_PRESETS, type LayoutPresetName } from '@/lib/constants';

interface ToolbarProps {
  onToggleProperties: () => void;
  showProperties: boolean;
  layoutPreset: LayoutPresetName | null;
  onLayoutPresetChange: (preset: LayoutPresetName) => void;
}

export function Toolbar({ onToggleProperties, showProperties, layoutPreset, onLayoutPresetChange }: ToolbarProps) {
  const hasPast = useHistoryStore((s) => s.past.length > 0);
  const hasFuture = useHistoryStore((s) => s.future.length > 0);
  const projectName = useProjectStore((s) => s.settings.name);
  const projectWidth = useProjectStore((s) => s.settings.width);
  const projectHeight = useProjectStore((s) => s.settings.height);

  const currentRatioLabel = (() => {
    const match = ASPECT_RATIO_PRESETS.find(
      (p) => p.width === projectWidth && p.height === projectHeight,
    );
    return match?.label ?? null;
  })();
  const [showExport, setShowExport] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [savedProjects, setSavedProjects] = useState<ProjectListItem[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loadingProject, setLoadingProject] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      await saveProject(projectName);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('idle');
    }
  }, [projectName]);

  const handleOpenLoad = useCallback(async () => {
    const projects = await listProjects();
    setSavedProjects(projects);
    setShowLoadModal(true);
  }, []);

  const handleLoad = useCallback(async (name: string) => {
    setLoadingProject(name);
    try {
      await loadProject(name);
      setShowLoadModal(false);
    } catch (err) {
      console.error('Load failed:', err);
    } finally {
      setLoadingProject(null);
    }
  }, []);

  const handleDelete = useCallback(async (name: string) => {
    await deleteProject(name);
    const projects = await listProjects();
    setSavedProjects(projects);
  }, []);

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Open shortcuts modal via '?' key (dispatched by useKeyboardShortcuts)
  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener('editor-open-shortcuts', handler);
    return () => window.removeEventListener('editor-open-shortcuts', handler);
  }, []);

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <div className="h-14 glass-panel flex items-center px-5 gap-4 flex-shrink-0 border-b border-[var(--glass-border)]">
        {/* Logo / Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white tracking-tight"
               style={{ boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3), inset 0 1px 1px rgba(255,255,255,0.2)' }}>
            VE
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={projectName}
              onChange={(e) => useProjectStore.getState().updateSettings({ name: e.target.value })}
              className="text-[13px] font-medium text-[var(--text-primary)] tracking-tight bg-transparent border-none outline-none hover:bg-[var(--hover-bg)] focus:bg-[var(--bg-tertiary)] rounded-lg px-1.5 py-0.5 -ml-1.5 w-40 focus:ring-1 focus:ring-[var(--accent)]"
              spellCheck={false}
            />
            {saveStatus === 'saved' && (
              <span className="text-[10px] text-emerald-500 font-medium animate-pulse">Saved</span>
            )}
          </div>
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

        <div className="w-px h-5 bg-[var(--border-color)]" />

        {/* Save / Load */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="p-2 rounded-xl hover:bg-[var(--hover-bg)] btn-icon-press text-[var(--text-secondary)] disabled:opacity-50"
            title="Save Project (Ctrl+S)"
          >
            {saveStatus === 'saving' ? (
              <svg className="w-[15px] h-[15px] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            ) : (
              <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v5h8V3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21v-7h10v7" />
              </svg>
            )}
          </button>
          <button
            onClick={handleOpenLoad}
            className="p-2 rounded-xl hover:bg-[var(--hover-bg)] btn-icon-press text-[var(--text-secondary)]"
            title="Load Project"
          >
            <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
            </svg>
          </button>
        </div>

        <div className="w-px h-5 bg-[var(--border-color)]" />

        {/* Aspect Ratio Selector */}
        <div className="flex items-center gap-1">
          {ASPECT_RATIO_PRESETS.map((preset) => {
            const active = currentRatioLabel === preset.label;
            return (
              <button
                key={preset.label}
                onClick={() => useProjectStore.getState().updateSettings({ width: preset.width, height: preset.height })}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium btn-press transition-colors ${
                  active
                    ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                }`}
                title={`${preset.width}×${preset.height}`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="w-px h-5 bg-[var(--border-color)]" />

        {/* Layout Presets */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-[var(--text-muted)] mr-0.5">Layout</span>
          {(Object.keys(LAYOUT_PRESETS) as LayoutPresetName[]).map((name) => (
            <button
              key={name}
              onClick={() => onLayoutPresetChange(name)}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium btn-press transition-colors ${
                layoutPreset === name
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
              title={name === 'Timeline' ? 'Timeline-focused layout' : name === 'Preview' ? 'Preview-focused layout' : 'Default layout'}
            >
              {name}
            </button>
          ))}
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

        {/* Keyboard Shortcuts Reference */}
        <button
          onClick={() => setShowShortcuts(true)}
          className="p-2 rounded-xl btn-icon-press hover:bg-[var(--hover-bg)] text-[var(--text-muted)]"
          title="Keyboard Shortcuts (?)"
        >
          <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </button>

        {/* Export Button — golden ring glassmorphism */}
        <div className="gold-ring-btn cursor-pointer" onClick={() => setShowExport(true)}>
          <div className="gold-ring-clip">
            <div className="gold-ring-gradient" />
          </div>
          <div className="gold-ring-inner px-5 py-2 text-[13px] font-semibold text-[var(--text-primary)]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Export
          </div>
        </div>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* Load Project Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={() => setShowLoadModal(false)}>
          <div
            className="glass-panel rounded-[1.25rem] w-[380px] max-h-[70vh] flex flex-col"
            style={{ boxShadow: 'var(--modal-shadow)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Load Project</h2>
              <button onClick={() => setShowLoadModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-icon-press">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {savedProjects.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">No saved projects yet. Save your current project first.</p>
              ) : (
                savedProjects.map((project) => (
                  <div
                    key={project.name}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-[var(--hover-bg)] group transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate">{project.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{formatDate(project.savedAt)}</div>
                    </div>
                    <button
                      onClick={() => handleLoad(project.name)}
                      disabled={loadingProject === project.name}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:bg-blue-400 btn-press disabled:opacity-50"
                    >
                      {loadingProject === project.name ? 'Loading...' : 'Open'}
                    </button>
                    <button
                      onClick={() => handleDelete(project.name)}
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 btn-icon-press opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete project"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
