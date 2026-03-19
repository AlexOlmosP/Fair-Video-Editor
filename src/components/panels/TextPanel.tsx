'use client';

import { useState } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { generateId } from '@/lib/id';

const FONT_OPTIONS = [
  'system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman',
  'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Palatino', 'Garamond', 'Bookman', 'Tahoma', 'Lucida Console',
  'Segoe UI', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins',
];

const TEXT_PRESETS = [
  { label: 'Default', fontSize: 48, fontFamily: 'system-ui', color: '#ffffff', bg: undefined },
  { label: 'Heading', fontSize: 72, fontFamily: 'system-ui', color: '#ffffff', bg: undefined },
  { label: 'Caption', fontSize: 36, fontFamily: 'system-ui', color: '#ffffff', bg: 'rgba(0,0,0,0.6)' },
  { label: 'Bold', fontSize: 56, fontFamily: 'system-ui', color: '#ffcc00', bg: undefined },
  { label: 'CTA Button', fontSize: 32, fontFamily: 'Arial', color: '#ffffff', bg: '#3b82f6' },
  { label: 'Subtitle', fontSize: 28, fontFamily: 'system-ui', color: '#e2e8f0', bg: 'rgba(0,0,0,0.5)' },
];

export function TextPanel() {
  const [selectedFont, setSelectedFont] = useState('system-ui');

  const addTextClip = (preset: typeof TEXT_PRESETS[number]) => {
    const { playheadTime, tracks, trackOrder, addTrack, addClip } = useTimelineStore.getState();

    let textTrackId = trackOrder.find((id) => tracks[id]?.type === 'text');
    if (!textTrackId) {
      textTrackId = addTrack('text', 'Text');
    }

    addClip({
      assetId: `text-${generateId()}`,
      trackId: textTrackId,
      startTime: playheadTime,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      speed: 1,
      opacity: 1,
      volume: 0,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      filters: [],
      keyframes: [],
      blendMode: 'normal',
      locked: false,
      visible: true,
      textData: {
        text: 'Default text',
        fontFamily: selectedFont,
        fontSize: preset.fontSize,
        color: preset.color,
        backgroundColor: preset.bg,
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-[var(--border-color)]">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Text</h3>
      </div>
      <div className="p-3 space-y-3">
        <p className="text-[11px] text-[var(--text-muted)]">Select a font, then click a style to add text. Double-click text on the preview to edit it.</p>

        {/* Font Selector */}
        <div>
          <label className="block text-[10px] text-[var(--text-muted)] mb-1 font-medium">Font Family</label>
          <select
            value={selectedFont}
            onChange={(e) => setSelectedFont(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>
        </div>

        {/* Font Preview */}
        <div
          className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-center text-[var(--text-primary)]"
          style={{ fontFamily: selectedFont, fontSize: 18 }}
        >
          The quick brown fox
        </div>

        {/* Style Presets */}
        <div className="space-y-2">
          <label className="block text-[10px] text-[var(--text-muted)] font-medium">Styles</label>
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => addTextClip(preset)}
              className="w-full px-3 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] btn-press hover-glow border border-[var(--border-color)] transition-colors text-left group"
            >
              <div
                className="text-center truncate"
                style={{
                  fontFamily: selectedFont,
                  fontSize: Math.min(preset.fontSize / 3, 20),
                  color: preset.color,
                  backgroundColor: preset.bg,
                  borderRadius: preset.bg ? 6 : 0,
                  padding: preset.bg ? '4px 12px' : 0,
                  display: 'inline-block',
                }}
              >
                {preset.label}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1 text-center">
                {preset.fontSize}px
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
