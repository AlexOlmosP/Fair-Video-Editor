'use client';

import { useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useHistoryStore } from '@/store/useHistoryStore';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      switch (e.code) {
        case 'Space': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          if (state.isPlaying) {
            state.setIsPlaying(false);
          } else {
            if (state.playheadTime >= state.duration && state.duration > 0) {
              state.setPlayheadTime(0);
            }
            state.setIsPlaying(true);
          }
          break;
        }

        case 'Delete':
        case 'Backspace': {
          const state = useTimelineStore.getState();
          const selected = state.selectedClipIds;
          if (selected.length > 0) {
            e.preventDefault();
            for (const id of selected) {
              state.removeClip(id);
            }
            state.deselectAll();
          }
          break;
        }

        case 'KeyZ': {
          if (ctrl && !e.shiftKey) {
            e.preventDefault();
            useHistoryStore.getState().undo();
          } else if (ctrl && e.shiftKey) {
            e.preventDefault();
            useHistoryStore.getState().redo();
          }
          break;
        }

        case 'KeyY': {
          if (ctrl) {
            e.preventDefault();
            useHistoryStore.getState().redo();
          }
          break;
        }

        case 'KeyS': {
          if (ctrl) {
            // Split selected clip at playhead
            e.preventDefault();
            const state = useTimelineStore.getState();
            const selected = state.selectedClipIds;
            if (selected.length === 1) {
              state.splitClip(selected[0], state.playheadTime);
            }
          }
          break;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          const step = ctrl ? 1 : 0.1;
          state.setPlayheadTime(Math.max(0, state.playheadTime - step));
          break;
        }

        case 'ArrowRight': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          const step = ctrl ? 1 : 0.1;
          state.setPlayheadTime(state.playheadTime + step);
          break;
        }

        case 'KeyA': {
          if (ctrl) {
            // Select all clips
            e.preventDefault();
            const state = useTimelineStore.getState();
            const allIds = Object.keys(state.clips);
            for (const id of allIds) {
              state.selectClip(id, true);
            }
          }
          break;
        }

        case 'Escape': {
          useTimelineStore.getState().deselectAll();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
