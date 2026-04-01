import type { TrackType } from '@/store/types';

export const TRACK_COLORS: Record<TrackType, string> = {
  video: '#3b82f6',   // blue
  audio: '#22c55e',   // green
  overlay: '#a855f7', // purple
  text: '#f59e0b',    // amber
  caption: '#06b6d4', // cyan
};

export const TRACK_DEFAULT_HEIGHT: Record<TrackType, number> = {
  video: 80,
  audio: 60,
  overlay: 60,
  text: 50,
  caption: 40,
};

export const PIXELS_PER_SECOND_BASE = 50;

export const MIN_CLIP_DURATION = 0.1; // seconds

export const SNAP_THRESHOLD_PX = 8;

export const DEFAULT_TRACKS: { type: TrackType; name: string }[] = [
  { type: 'video', name: 'Video 1' },
  { type: 'audio', name: 'Audio 1' },
];

export const ASPECT_RATIO_PRESETS = [
  { label: '16:9', ratio: 16 / 9, width: 1920, height: 1080 },
  { label: '9:16', ratio: 9 / 16, width: 1080, height: 1920 },
  { label: '1:1',  ratio: 1,       width: 1080, height: 1080 },
  { label: '4:5',  ratio: 4 / 5,  width: 1080, height: 1350 },
  { label: '4:3',  ratio: 4 / 3,  width: 1440, height: 1080 },
] as const;

/**
 * Compute industry-standard export dimensions from a quality preset key and aspect ratio.
 * Uses the preset's short-edge dimension as the base.
 */
export function getExportDimensions(
  presetKey: string,
  ratioLabel: string | null,
  presetWidth: number,
  presetHeight: number,
): { width: number; height: number } {
  if (!ratioLabel) return { width: presetWidth, height: presetHeight };

  // Short edge = smaller of preset dimensions (720 for 720p, 1080 for 1080p, 2160 for 4K)
  const shortEdge = Math.min(presetWidth, presetHeight);

  switch (ratioLabel) {
    case '16:9': return { width: Math.round(shortEdge * 16 / 9), height: shortEdge };
    case '9:16': return { width: shortEdge, height: Math.round(shortEdge * 16 / 9) };
    case '4:5':  return { width: shortEdge, height: Math.round(shortEdge * 5 / 4) };
    case '1:1':  return { width: shortEdge, height: shortEdge };
    default:     return { width: presetWidth, height: presetHeight };
  }
}

export const ANIMATION_SUBLANE_HEIGHT = 32;

export const LAYOUT_PRESETS = {
  Default:  { leftPanelWidth: 328, rightPanelWidth: 260, timelineHeight: 300 },
  Timeline: { leftPanelWidth: 280, rightPanelWidth: 220, timelineHeight: 450 },
  Preview:  { leftPanelWidth: 260, rightPanelWidth: 260, timelineHeight: 200 },
} as const;

export type LayoutPresetName = keyof typeof LAYOUT_PRESETS;
