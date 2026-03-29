import { create } from 'zustand';

/**
 * Manages HTMLVideoElement / HTMLImageElement instances for preview rendering.
 * Also stores decoded waveform peak data for audio visualization.
 * Maps assetId -> media element so the canvas renderer can draw frames.
 */
interface MediaState {
  elements: Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>;
  /** Decoded amplitude peaks per audio asset (0–1 per sample). */
  waveforms: Record<string, Float32Array>;
  register: (assetId: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => void;
  unregister: (assetId: string) => void;
  getElement: (assetId: string) => HTMLVideoElement | HTMLImageElement | HTMLAudioElement | undefined;
  registerWaveform: (assetId: string, peaks: Float32Array) => void;
  getWaveform: (assetId: string) => Float32Array | undefined;
}

/** Safely extract width/height from any media element. Audio elements return 0. */
export function getSourceDimensions(
  source: HTMLVideoElement | HTMLImageElement | HTMLAudioElement,
  fallbackW: number,
  fallbackH: number,
): { srcW: number; srcH: number } {
  if (source instanceof HTMLAudioElement) return { srcW: fallbackW, srcH: fallbackH };
  const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || fallbackW;
  const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || fallbackH;
  return { srcW, srcH };
}

export const useMediaStore = create<MediaState>((set, get) => ({
  elements: {},
  waveforms: {},

  register: (assetId, element) => {
    set((s) => ({ elements: { ...s.elements, [assetId]: element } }));
  },

  unregister: (assetId) => {
    set((s) => {
      const { [assetId]: _, ...rest } = s.elements;
      const { [assetId]: _w, ...restW } = s.waveforms;
      return { elements: rest, waveforms: restW };
    });
  },

  getElement: (assetId) => get().elements[assetId],

  registerWaveform: (assetId, peaks) => {
    set((s) => ({ waveforms: { ...s.waveforms, [assetId]: peaks } }));
  },

  getWaveform: (assetId) => get().waveforms[assetId],
}));
