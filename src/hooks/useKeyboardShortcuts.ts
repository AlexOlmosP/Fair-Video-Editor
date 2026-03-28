'use client';

import { useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useProjectStore } from '@/store/useProjectStore';
import type { HistoryAction } from '@/store/types';

function applyHistoryAction(action: HistoryAction, direction: 'undo' | 'redo') {
  const payload = direction === 'undo' ? action.before : action.after;
  if (payload.timeline) {
    useTimelineStore.getState()._restoreTimeline(payload.timeline);
  }
  if (payload.project) {
    useProjectStore.getState()._restoreProject(payload.project);
  }
}

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
          // If in shuttle mode, Space acts like K (stop shuttle + pause)
          if (state.shuttleSpeed !== 0) {
            state.setShuttleSpeed(0);
            state.setIsPlaying(false);
          } else if (state.isPlaying) {
            state.setIsPlaying(false);
          } else {
            if (state.playheadTime >= state.duration && state.duration > 0) {
              state.setPlayheadTime(0);
            }
            state.setIsPlaying(true);
          }
          break;
        }

        // ── J/K/L Shuttle ──────────────────────────────────────────
        case 'KeyJ': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          const bwdSpeeds = [-1, -2, -4, -8];
          const cur = state.shuttleSpeed;
          if (cur >= 0) {
            // Paused or going forward → start backward at 1x
            state.setShuttleSpeed(-1);
            state.setIsPlaying(true);
          } else {
            // Already backward → ramp up (more negative)
            const idx = bwdSpeeds.indexOf(cur);
            const nextIdx = Math.min(bwdSpeeds.length - 1, idx < 0 ? 0 : idx + 1);
            state.setShuttleSpeed(bwdSpeeds[nextIdx]);
          }
          break;
        }

        case 'KeyK': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          state.setShuttleSpeed(0);
          state.setIsPlaying(false);
          break;
        }

        case 'KeyL': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          const fwdSpeeds = [1, 2, 4, 8];
          const cur = state.shuttleSpeed;
          if (cur <= 0) {
            // Paused or going backward → start forward at 1x
            state.setShuttleSpeed(1);
            state.setIsPlaying(true);
          } else {
            // Already forward → ramp up
            const idx = fwdSpeeds.indexOf(cur);
            const nextIdx = Math.min(fwdSpeeds.length - 1, idx < 0 ? 0 : idx + 1);
            state.setShuttleSpeed(fwdSpeeds[nextIdx]);
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
            const action = useHistoryStore.getState().undo();
            if (action) applyHistoryAction(action, 'undo');
          } else if (ctrl && e.shiftKey) {
            e.preventDefault();
            const action = useHistoryStore.getState().redo();
            if (action) applyHistoryAction(action, 'redo');
          }
          break;
        }

        case 'KeyY': {
          if (ctrl) {
            e.preventDefault();
            const action = useHistoryStore.getState().redo();
            if (action) applyHistoryAction(action, 'redo');
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

        // ── Markers & In/Out Points ────────────────────────────────
        case 'KeyM': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          state.addMarker(state.playheadTime);
          break;
        }

        case 'KeyI': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          state.setInPoint(state.playheadTime);
          break;
        }

        case 'KeyO': {
          e.preventDefault();
          const state = useTimelineStore.getState();
          state.setOutPoint(state.playheadTime);
          break;
        }

        case 'Escape': {
          useTimelineStore.getState().deselectAll();
          break;
        }

        // ── Shortcuts reference modal ──────────────────────────────
        case 'Slash': {
          if (e.shiftKey) {
            // '?' = Shift+/
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('editor-open-shortcuts'));
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
