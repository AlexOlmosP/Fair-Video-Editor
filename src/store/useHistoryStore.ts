import { create } from 'zustand';
import type { HistoryAction } from './types';

const MAX_HISTORY = 100;

interface HistoryState {
  past: HistoryAction[];
  future: HistoryAction[];

  pushAction: (action: HistoryAction) => void;
  undo: () => HistoryAction | undefined;
  redo: () => HistoryAction | undefined;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  pushAction: (action) => {
    set((s) => ({
      past: [...s.past.slice(-(MAX_HISTORY - 1)), action],
      future: [], // clear redo stack on new action
    }));
  },

  undo: () => {
    const { past } = get();
    if (past.length === 0) return undefined;
    const action = past[past.length - 1];
    set((s) => ({
      past: s.past.slice(0, -1),
      future: [action, ...s.future],
    }));
    return action;
  },

  redo: () => {
    const { future } = get();
    if (future.length === 0) return undefined;
    const action = future[0];
    set((s) => ({
      past: [...s.past, action],
      future: s.future.slice(1),
    }));
    return action;
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  clear: () => set({ past: [], future: [] }),
}));
