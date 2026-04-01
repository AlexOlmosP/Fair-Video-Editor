/** Shared types for the video processing engine */

export type ExportFormat = 'mp4' | 'webm';
export type ExportCodec = 'libx264' | 'libvpx-vp9';

export interface ExportPreset {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: string;
  audioBitrate: string;
  codec: string;
  format: string;
}

export interface ExportSettings {
  format: ExportFormat;
  codec: ExportCodec;
  resolutionKey: string;       // key into RESOLUTION_PRESETS
  frameRate: number;
  videoBitrate: string;        // e.g. '10000k'
  audioBitrate: string;        // e.g. '192k'
  bitrateMode: 'vbr' | 'cbr'; // variable or constant bitrate
}

/** Base short-edge sizes for each quality tier */
const RESOLUTION_TIERS = [
  { key: '720p',  label: '720p HD',       shortEdge: 720  },
  { key: '1080p', label: '1080p Full HD', shortEdge: 1080 },
  { key: '2k',    label: '2K QHD',        shortEdge: 1440 },
  { key: '4k',    label: '4K Ultra HD',   shortEdge: 2160 },
];

/** Generate resolution presets based on the project's canvas dimensions */
export function getResolutionPresets(
  projectWidth: number,
  projectHeight: number
): Record<string, { label: string; width: number; height: number }> {
  const isLandscape = projectWidth >= projectHeight;
  const aspectRatio = projectWidth / projectHeight;
  const presets: Record<string, { label: string; width: number; height: number }> = {};

  for (const tier of RESOLUTION_TIERS) {
    let w: number, h: number;
    if (isLandscape) {
      h = tier.shortEdge;
      w = Math.round(h * aspectRatio);
    } else {
      w = tier.shortEdge;
      h = Math.round(w / aspectRatio);
    }
    // Ensure even dimensions for video codecs
    w = w - (w % 2);
    h = h - (h % 2);
    presets[tier.key] = { label: `${tier.label} (${w}×${h})`, width: w, height: h };
  }
  return presets;
}

/** Static 16:9 presets for backwards compatibility */
export const RESOLUTION_PRESETS: Record<string, { label: string; width: number; height: number }> = {
  '720p':  { label: '720p HD',       width: 1280,  height: 720  },
  '1080p': { label: '1080p Full HD', width: 1920,  height: 1080 },
  '2k':    { label: '2K QHD',        width: 2560,  height: 1440 },
  '4k':    { label: '4K Ultra HD',   width: 3840,  height: 2160 },
};

export const FRAME_RATE_OPTIONS = [24, 30, 60] as const;

export const QUALITY_PRESETS_MAP: Record<string, { label: string; videoBitrate: string; audioBitrate: string }> = {
  standard: { label: 'Standard',  videoBitrate: '5000k',  audioBitrate: '128k' },
  high:     { label: 'High',      videoBitrate: '12000k', audioBitrate: '192k' },
  ultra:    { label: 'Ultra',     videoBitrate: '25000k', audioBitrate: '256k' },
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  codec: 'libx264',
  resolutionKey: '1080p',
  frameRate: 30,
  videoBitrate: '12000k',
  audioBitrate: '192k',
  bitrateMode: 'vbr',
};

export interface RenderFrame {
  timestamp: number;
  layers: RenderLayer[];
}

export interface RenderLayer {
  clipId: string;
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  opacity: number;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  blendMode: string;
  filters: ProcessorEffect[];
}

export interface ProcessorEffect {
  type: string;
  params: Record<string, number | string | boolean>;
  enabled: boolean;
}

export interface ProcessorResult {
  canvas?: HTMLCanvasElement;
  imageData?: ImageData;
}
