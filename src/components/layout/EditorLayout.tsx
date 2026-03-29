'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Toolbar } from './Toolbar';
import { Sidebar, type SidebarTab } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { AssetsPanel } from '../panels/AssetsPanel';
import { EffectsPanel } from '../panels/EffectsPanel';
import { CaptionEditor } from '../panels/CaptionEditor';
import { TTSPanel } from '../panels/TTSPanel';
import { TextPanel } from '../panels/TextPanel';
import { EmojiPanel } from '../panels/EmojiPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { PreviewPlayer } from '../preview/PreviewPlayer';
import { Timeline } from '../timeline/Timeline';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useAudioScrub } from '@/hooks/useAudioScrub';
import { LAYOUT_PRESETS, type LayoutPresetName } from '@/lib/constants';

const LAYOUT_STORAGE_KEY = 'fair-video-editor-layout';

function loadSavedLayout() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || 'null') as {
      leftPanelWidth: number;
      rightPanelWidth: number;
      timelineHeight: number;
      activePreset: LayoutPresetName | null;
    } | null;
  } catch {
    return null;
  }
}

export function EditorLayout() {
  useKeyboardShortcuts();
  useAudioPlayback();
  useAudioScrub();

  const [leftPanelWidth, setLeftPanelWidth] = useState(328);
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [activePreset, setActivePreset] = useState<LayoutPresetName | null>('Default');
  const [isDragOver, setIsDragOver] = useState(false);
  const [leftTab, setLeftTab] = useState<SidebarTab>('media');
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Restore saved layout on mount (client only)
  useEffect(() => {
    const saved = loadSavedLayout();
    if (saved) {
      setLeftPanelWidth(saved.leftPanelWidth);
      setRightPanelWidth(saved.rightPanelWidth);
      setTimelineHeight(saved.timelineHeight);
      setActivePreset(saved.activePreset);
    }
  }, []);

  // Persist layout to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ leftPanelWidth, rightPanelWidth, timelineHeight, activePreset }));
  }, [leftPanelWidth, rightPanelWidth, timelineHeight, activePreset]);

  const applyPreset = useCallback((name: LayoutPresetName) => {
    const preset = LAYOUT_PRESETS[name];
    setLeftPanelWidth(preset.leftPanelWidth);
    setRightPanelWidth(preset.rightPanelWidth);
    setTimelineHeight(preset.timelineHeight);
    setActivePreset(name);
  }, []);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      window.dispatchEvent(new CustomEvent('editor-file-drop', { detail: e.dataTransfer.files }));
    }
  }, []);

  return (
    <div
      className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden relative"
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-[var(--accent)]/10 border-4 border-dashed border-[var(--accent)] flex items-center justify-center pointer-events-none backdrop-blur-sm">
          <div className="bg-[var(--bg-secondary)] px-8 py-4 rounded-2xl border border-[var(--accent)]/50" style={{ boxShadow: 'var(--elevated-shadow)' }}>
            <span className="text-[var(--accent)] text-lg font-medium">Drop files anywhere to import</span>
          </div>
        </div>
      )}

      <Toolbar
        onToggleProperties={() => setShowRightPanel((v) => !v)}
        showProperties={showRightPanel}
        layoutPreset={activePreset}
        onLayoutPresetChange={applyPreset}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel — Sidebar + Content */}
        <div
          className="flex-shrink-0 glass-panel flex"
          style={{ width: leftPanelWidth }}
        >
          <Sidebar activeTab={leftTab} onTabChange={setLeftTab} />
          <div className="flex-1 overflow-y-auto border-r border-[var(--glass-border)] panel-enter" key={leftTab}>
            {leftTab === 'media' && <AssetsPanel />}
            {leftTab === 'text' && <TextPanel />}
            {leftTab === 'emojis' && <EmojiPanel />}
            {leftTab === 'effects' && <EffectsPanel />}
            {leftTab === 'captions' && <CaptionEditor />}
            {leftTab === 'tts' && <TTSPanel />}
            {leftTab === 'settings' && <SettingsPanel />}
          </div>
        </div>

        {/* Left Panel Resize Handle */}
        <div
          className="w-1.5 cursor-col-resize bg-transparent hover:bg-[var(--accent)]/50 transition-all duration-200 flex-shrink-0"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = leftPanelWidth;
            const onMove = (me: MouseEvent) => {
              setLeftPanelWidth(Math.max(200, Math.min(500, startWidth + me.clientX - startX)));
              setActivePreset(null);
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />

        {/* Preview Area */}
        <div className="flex-1 min-w-0 bg-[var(--bg-primary)] flex flex-col">
          {/* Theme Toggle - centered above preview */}
          <div className="flex justify-center py-1.5 flex-shrink-0">
            <ThemeToggle />
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0">
            <PreviewPlayer />
          </div>
        </div>

        {/* Right Panel — Properties (collapsible) */}
        {showRightPanel && (
          <>
            <div
              className="w-1.5 cursor-col-resize bg-transparent hover:bg-[var(--accent)]/50 transition-all duration-200 flex-shrink-0"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startWidth = rightPanelWidth;
                const onMove = (me: MouseEvent) => {
                  setRightPanelWidth(Math.max(200, Math.min(400, startWidth - (me.clientX - startX))));
                  setActivePreset(null);
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <div
              className="flex-shrink-0 border-l border-[var(--glass-border)] glass-panel overflow-y-auto"
              style={{ width: rightPanelWidth }}
            >
              <PropertiesPanel />
            </div>
          </>
        )}
      </div>

      {/* Timeline Resize Handle */}
      <div
        className="h-1.5 cursor-row-resize bg-transparent hover:bg-[var(--accent)]/50 transition-all duration-200 flex-shrink-0"
        onMouseDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startHeight = timelineHeight;
          const onMove = (me: MouseEvent) => {
            setTimelineHeight(Math.max(150, Math.min(600, startHeight - (me.clientY - startY))));
            setActivePreset(null);
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      />

      {/* Timeline Area */}
      <div
        className="flex-shrink-0 border-t border-[var(--glass-border)] glass-panel"
        style={{ height: timelineHeight }}
      >
        <Timeline />
      </div>
    </div>
  );
}
