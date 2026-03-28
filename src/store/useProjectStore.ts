import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { MediaAsset, ProjectSettings, ProjectSnapshot } from './types';
import { DEFAULT_PROJECT_SETTINGS } from './types';
import { useHistoryStore } from './useHistoryStore';

interface ProjectState {
  settings: ProjectSettings;
  assets: Record<string, MediaAsset>;
  safeAreaRatio: string | null;
  aspectRatioLocked: boolean;

  updateSettings: (updates: Partial<ProjectSettings>) => void;
  addAsset: (asset: Omit<MediaAsset, 'id'>) => string;
  removeAsset: (assetId: string) => void;
  getAsset: (assetId: string) => MediaAsset | undefined;
  setSafeAreaRatio: (ratio: string | null) => void;
  setAspectRatioLocked: (locked: boolean) => void;

  // History helpers (used by undo/redo to restore state)
  _snapshotProject: () => ProjectSnapshot;
  _restoreProject: (snapshot: ProjectSnapshot) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  settings: { ...DEFAULT_PROJECT_SETTINGS },
  assets: {},
  safeAreaRatio: null,
  aspectRatioLocked: true,

  // ─── History Helpers ─────────────────────────────────────────

  _snapshotProject: () => ({ settings: { ...get().settings } }),

  _restoreProject: (snapshot) => {
    set({ settings: snapshot.settings });
  },

  // ─── Mutations ───────────────────────────────────────────────

  updateSettings: (updates) => {
    const before = get()._snapshotProject();
    set((s) => ({ settings: { ...s.settings, ...updates } }));
    useHistoryStore.getState().pushAction({
      type: 'updateSettings',
      timestamp: Date.now(),
      before: { project: before },
      after: { project: get()._snapshotProject() },
    });
  },

  addAsset: (assetData) => {
    const id = uuid();
    const asset: MediaAsset = { ...assetData, id };
    set((s) => ({ assets: { ...s.assets, [id]: asset } }));
    return id;
  },

  removeAsset: (assetId) => {
    set((s) => {
      const { [assetId]: _, ...remaining } = s.assets;
      return { assets: remaining };
    });
  },

  getAsset: (assetId) => get().assets[assetId],

  setSafeAreaRatio: (ratio) => set({ safeAreaRatio: ratio }),
  setAspectRatioLocked: (locked) => set({ aspectRatioLocked: locked }),
}));
