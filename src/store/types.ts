// ============================================================
// Core Types for the Video Editor Timeline State
// Follows normalized state pattern from timeline-state-manager
// ============================================================

export type TrackType = 'video' | 'audio' | 'overlay' | 'text' | 'caption';

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export interface ClipGroup {
  id: string;
  color: string;
}

// ─── Color Correction ──────────────────────────────────────────────────────

export interface HslChannelAdjustment {
  hue: number;        // -100 to +100
  saturation: number; // -100 to +100
  luminance: number;  // -100 to +100
}

export interface ColorCorrectionParams {
  /** All values: -100 to +100, where 0 = no change */
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  hsl: {
    red: HslChannelAdjustment;
    orange: HslChannelAdjustment;
    yellow: HslChannelAdjustment;
    green: HslChannelAdjustment;
    cyan: HslChannelAdjustment;
    blue: HslChannelAdjustment;
    purple: HslChannelAdjustment;
    magenta: HslChannelAdjustment;
  };
}

const _Z: HslChannelAdjustment = { hue: 0, saturation: 0, luminance: 0 };

export const DEFAULT_COLOR_CORRECTION: ColorCorrectionParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hsl: {
    red:     { ..._Z },
    orange:  { ..._Z },
    yellow:  { ..._Z },
    green:   { ..._Z },
    cyan:    { ..._Z },
    blue:    { ..._Z },
    purple:  { ..._Z },
    magenta: { ..._Z },
  },
};

export interface Keyframe {
  id: string;
  /** Time relative to the clip's internal start, NOT the global timeline */
  time: number;
  property: string;
  value: number;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';
  bezierControls?: [number, number, number, number];
}

export interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  src: string;
  duration: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  size?: number;
  dateAdded?: number;
}

export interface ClipAnimation {
  id: string;
  presetId: string;
  presetLabel: string;
  /** Start time relative to clip start (seconds) */
  startTime: number;
  /** End time relative to clip start (seconds) */
  endTime: number;
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  /** Start position on the global timeline (seconds) */
  startTime: number;
  /** Duration of the clip on the timeline (seconds) */
  duration: number;
  /** In-point within the source media (seconds) */
  inPoint: number;
  /** Out-point within the source media (seconds) */
  outPoint: number;
  /** Playback speed multiplier */
  speed: number;
  /** Visual properties */
  opacity: number;
  volume: number;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  /** Filters and effects applied */
  filters: string[];
  /** Per-clip color correction (Basic + HSL panels) */
  colorCorrection?: ColorCorrectionParams;
  /** Keyframe animations */
  keyframes: Keyframe[];
  /** Named animation presets with timing */
  animations?: ClipAnimation[];
  /** Blend mode for compositing */
  blendMode: BlendMode;
  /** ID of parent clip for attached assets (e.g., captions synced to a video) */
  parentClipId?: string;
  /** Freeze frame: if set, always shows this source time */
  freezeFrame?: { sourceTime: number };
  /** Text overlay data (for text/caption clips) */
  textData?: TextData;
  /** TTS data (for text-to-speech clips) */
  ttsData?: TTSData;
  /** Transition effect data (for transition clips) */
  transitionData?: TransitionData;
  /** Whether this clip is locked from editing */
  locked: boolean;
  /** Whether this clip is visible */
  visible: boolean;
  /** Crop values as percentages 0-100 (how much to trim from each edge) */
  crop?: { top: number; right: number; bottom: number; left: number };
  /** Group this clip belongs to */
  groupId?: string;
}

export type TransitionType = 'fade-black' | 'fade-white' | 'crossfade';

export interface TransitionData {
  type: TransitionType;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  order: number;
  height: number;
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  sampleRate: number;
  backgroundColor: string;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  name: 'Untitled Project',
  width: 1920,
  height: 1080,
  frameRate: 30,
  sampleRate: 44100,
  backgroundColor: '#000000',
};

export interface CaptionEntry {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface TextData {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface TTSData {
  text: string;
  voice: string;
  lang: string;
  rate: number;
  pitch: number;
}

export interface TimelineMarker {
  id: string;
  time: number;
  label?: string;
  color?: string;
}

export interface TimelineSnapshot {
  tracks: Record<string, Track>;
  clips: Record<string, Clip>;
  trackOrder: string[];
  groups?: Record<string, ClipGroup>;
}

export interface ProjectSnapshot {
  settings: ProjectSettings;
}

export type HistoryPayload = {
  timeline?: TimelineSnapshot;
  project?: ProjectSnapshot;
};

export type HistoryAction = {
  type: string;
  timestamp: number;
  before: HistoryPayload;
  after: HistoryPayload;
};
