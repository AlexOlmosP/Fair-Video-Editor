'use client';

import React, { useState, useCallback } from 'react';
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

export function EditorLayout() {
  useKeyboardShortcuts();
  useAudioPlayback();
  const [leftPanelWidth, setLeftPanelWidth] = useState(328);
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [isDragOver, setIsDragOver] = useState(false);
  const [leftTab, setLeftTab] = useState<SidebarTab>('media');
  const [showRightPanel, setShowRightPanel] = useState(true);

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

      <Toolbar onToggleProperties={() => setShowRightPanel((v) => !v)} showProperties={showRightPanel} />

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel — Sidebar + Content */}
        <div
          className="flex-shrink-0 bg-[var(--bg-secondary)] flex"
          style={{ width: leftPanelWidth, boxShadow: 'var(--panel-shadow)' }}
        >
          <Sidebar activeTab={leftTab} onTabChange={setLeftTab} />
          <div className="flex-1 overflow-y-auto border-r border-[var(--border-color)] panel-enter" key={leftTab}>
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
              className="flex-shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-y-auto"
              style={{ width: rightPanelWidth, boxShadow: 'var(--panel-shadow)' }}
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
        className="flex-shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]"
        style={{ height: timelineHeight }}
      >
        <Timeline />
      </div>
    </div>
  );
}
