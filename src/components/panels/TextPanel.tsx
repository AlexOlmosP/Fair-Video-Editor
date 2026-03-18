'use client';

import { useTimelineStore } from '@/store/useTimelineStore';
import { generateId } from '@/lib/id';

const TEXT_PRESETS = [
  { label: 'Default', fontSize: 48, fontFamily: 'system-ui', color: '#ffffff', bg: undefined },
  { label: 'Heading', fontSize: 72, fontFamily: 'system-ui', color: '#ffffff', bg: undefined },
  { label: 'Caption', fontSize: 36, fontFamily: 'system-ui', color: '#ffffff', bg: 'rgba(0,0,0,0.6)' },
  { label: 'Bold', fontSize: 56, fontFamily: 'system-ui', color: '#ffcc00', bg: undefined },
];

export function TextPanel() {
  const addTextClip = (preset: typeof TEXT_PRESETS[number]) => {
    const { playheadTime, tracks, trackOrder, addTrack, addClip } = useTimelineStore.getState();

    // Find or create a text track
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
        fontFamily: preset.fontFamily,
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
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-[var(--text-muted)] mb-3">Click a style to add text at the playhead position.</p>
        {TEXT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addTextClip(preset)}
            className="w-full px-3 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-zinc-700 transition-colors text-left group"
          >
            <div
              className="text-center truncate"
              style={{
                fontFamily: preset.fontFamily,
                fontSize: Math.min(preset.fontSize / 3, 20),
                color: preset.color,
                backgroundColor: preset.bg,
                borderRadius: preset.bg ? 4 : 0,
                padding: preset.bg ? '2px 6px' : 0,
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
  );
}
