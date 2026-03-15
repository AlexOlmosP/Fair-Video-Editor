'use client';

import React, { useState, useCallback } from 'react';
import { Toolbar } from './Toolbar';
import { AssetsPanel } from '../panels/AssetsPanel';
import { EffectsPanel } from '../panels/EffectsPanel';
import { CaptionEditor } from '../panels/CaptionEditor';
import { TTSPanel } from '../panels/TTSPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { PreviewPlayer } from '../preview/PreviewPlayer';
import { Timeline } from '../timeline/Timeline';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';

type LeftTab = 'assets' | 'effects' | 'captions' | 'tts';
type RightTab = 'properties';

export function EditorLayout() {
  useKeyboardShortcuts();
  useAudioPlayback();
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [isDragOver, setIsDragOver] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('assets');
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
      className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden relative"
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-blue-600/10 border-4 border-dashed border-blue-500 flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900/90 px-8 py-4 rounded-xl border border-blue-500/50">
            <span className="text-blue-400 text-lg font-medium">Drop files anywhere to import</span>
          </div>
        </div>
      )}

      <Toolbar onToggleProperties={() => setShowRightPanel((v) => !v)} showProperties={showRightPanel} />

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel — Tabbed: Assets / Effects */}
        <div
          className="flex-shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col"
          style={{ width: leftPanelWidth }}
        >
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800 flex-shrink-0">
            {(['assets', 'effects', 'captions', 'tts'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`flex-1 px-2 py-2 text-[10px] font-medium transition-colors ${
                  leftTab === tab
                    ? 'text-white border-b-2 border-blue-500 bg-zinc-800/50'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab === 'tts' ? 'TTS' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {leftTab === 'assets' && <AssetsPanel />}
            {leftTab === 'effects' && <EffectsPanel />}
            {leftTab === 'captions' && <CaptionEditor />}
            {leftTab === 'tts' && <TTSPanel />}
          </div>
        </div>

        {/* Left Panel Resize Handle */}
        <div
          className="w-1 cursor-col-resize bg-zinc-800 hover:bg-blue-500 transition-colors flex-shrink-0"
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
        <div className="flex-1 min-w-0 bg-zinc-950 flex items-center justify-center">
          <PreviewPlayer />
        </div>

        {/* Right Panel — Properties (collapsible) */}
        {showRightPanel && (
          <>
            <div
              className="w-1 cursor-col-resize bg-zinc-800 hover:bg-blue-500 transition-colors flex-shrink-0"
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
              className="flex-shrink-0 border-l border-zinc-800 bg-zinc-900 overflow-y-auto"
              style={{ width: rightPanelWidth }}
            >
              <PropertiesPanel />
            </div>
          </>
        )}
      </div>

      {/* Timeline Resize Handle */}
      <div
        className="h-1 cursor-row-resize bg-zinc-800 hover:bg-blue-500 transition-colors flex-shrink-0"
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
        className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900"
        style={{ height: timelineHeight }}
      >
        <Timeline />
      </div>
    </div>
  );
}
