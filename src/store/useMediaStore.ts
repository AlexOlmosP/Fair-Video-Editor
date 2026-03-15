import { create } from 'zustand';

/**
 * Manages HTMLVideoElement / HTMLImageElement instances for preview rendering.
 * Maps assetId -> media element so the canvas renderer can draw frames.
 */
interface MediaState {
  elements: Record<string, HTMLVideoElement | HTMLImageElement>;
  register: (assetId: string, element: HTMLVideoElement | HTMLImageElement) => void;
  unregister: (assetId: string) => void;
  getElement: (assetId: string) => HTMLVideoElement | HTMLImageElement | undefined;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  elements: {},

  register: (assetId, element) => {
    set((s) => ({ elements: { ...s.elements, [assetId]: element } }));
  },

  unregister: (assetId) => {
    set((s) => {
      const { [assetId]: _, ...rest } = s.elements;
      return { elements: rest };
    });
  },

  getElement: (assetId) => get().elements[assetId],
}));
