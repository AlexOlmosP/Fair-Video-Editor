import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Clip, ClipGroup, Track, TrackType, Keyframe, ClipAnimation, TransitionType, TimelineSnapshot, TimelineMarker } from './types';
import { generateKeyframesFromAnimations } from '@/engine/animation/presets';
import { useHistoryStore } from './useHistoryStore';

// ─── Group Color Palette ─────────────────────────────────────────────────────
const GROUP_COLORS = ['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#06b6d4', '#f97316'];

// ─── History Batch Suppression ───────────────────────────────────────────────
// Prevents compound operations from pushing multiple history entries.
// Each outer operation increments the depth; inner calls skip pushing.
let _suppressDepth = 0;
const isSuppressed = () => _suppressDepth > 0;
export const suppressHistory = () => { _suppressDepth++; };
export const restoreHistorySuppression = () => { _suppressDepth--; };

function pushTimelineHistory(type: string, before: TimelineSnapshot, after: TimelineSnapshot) {
  if (isSuppressed()) return;
  useHistoryStore.getState().pushAction({
    type,
    timestamp: Date.now(),
    before: { timeline: before },
    after: { timeline: after },
  });
}

interface TimelineState {
  // Data
  tracks: Record<string, Track>;
  clips: Record<string, Clip>;
  trackOrder: string[];
  groups: Record<string, ClipGroup>;

  // Playback
  playheadTime: number;
  isPlaying: boolean;
  duration: number;
  zoom: number;
  scrollX: number;

  // Selection
  selectedClipIds: string[];
  selectedTrackId: string | null;

  // Markers & In/Out Points
  markers: TimelineMarker[];
  inPoint: number | null;
  outPoint: number | null;

  // Shuttle Scrubbing (J/K/L)
  // 0 = not shuttling, positive = forward, negative = backward
  shuttleSpeed: number;

  // Actions — Tracks
  addTrack: (type: TrackType, name?: string) => string;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;
  removeTrack: (trackId: string) => void;
  reorderTracks: (trackOrder: string[]) => void;

  // Actions — Clips
  addClip: (clip: Omit<Clip, 'id'>) => string;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  moveClip: (clipId: string, trackId: string, startTime: number) => void;
  splitClip: (clipId: string, splitTime: number) => [string, string] | null;

  // Actions — Groups
  groupClips: (clipIds: string[]) => string;
  ungroupClips: (groupId: string) => void;
  removeGroup: (groupId: string) => void;
  moveGroupClips: (groupId: string, leadClipId: string, newLeadStartTime: number) => void;

  // Actions — Playback
  setPlayheadTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setScrollX: (scrollX: number) => void;

  // Actions — Selection
  selectClip: (clipId: string, multi?: boolean) => void;
  selectTrack: (trackId: string) => void;
  deselectAll: () => void;

  // Actions — Markers
  addMarker: (time: number, label?: string) => string;
  removeMarker: (markerId: string) => void;
  updateMarker: (markerId: string, updates: Partial<TimelineMarker>) => void;
  setInPoint: (time: number | null) => void;
  setOutPoint: (time: number | null) => void;

  // Actions — Shuttle
  setShuttleSpeed: (speed: number) => void;

  // UI State — Crop Mode
  isCropMode: boolean;
  setCropMode: (active: boolean) => void;

  // Actions — Transitions
  insertTransition: (trackId: string, time: number, duration?: number, type?: TransitionType) => string | null;

  // Actions — Freeze Frame
  insertFreezeFrame: (clipId: string, duration: number) => string | null;

  // Actions — Keyframes
  addKeyframe: (clipId: string, keyframe: Omit<Keyframe, 'id'>) => string;
  updateKeyframe: (clipId: string, keyframeId: string, updates: Partial<Keyframe>) => void;
  removeKeyframe: (clipId: string, keyframeId: string) => void;
  setClipKeyframes: (clipId: string, keyframes: Keyframe[]) => void;

  // Actions — Animations
  addAnimation: (clipId: string, animation: Omit<ClipAnimation, 'id'>) => string;
  updateAnimation: (clipId: string, animationId: string, updates: Partial<ClipAnimation>) => void;
  removeAnimation: (clipId: string, animationId: string) => void;

  // History helpers (used by undo/redo to restore state)
  _snapshotTimeline: () => TimelineSnapshot;
  _restoreTimeline: (snapshot: TimelineSnapshot) => void;
  _pushHistory: (type: string, before: TimelineSnapshot, after: TimelineSnapshot) => void;

  // Computed
  recalculateDuration: () => void;
  getClipsOnTrack: (trackId: string) => Clip[];
  getClipAtTime: (trackId: string, time: number) => Clip | undefined;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  tracks: {},
  clips: {},
  trackOrder: [],
  groups: {},
  playheadTime: 0,
  isPlaying: false,
  duration: 0,
  zoom: 1,
  scrollX: 0,
  selectedClipIds: [],
  selectedTrackId: null,
  markers: [],
  inPoint: null,
  outPoint: null,
  shuttleSpeed: 0,
  isCropMode: false,

  // ─── History Helpers ─────────────────────────────────────────

  _snapshotTimeline: () => {
    const { tracks, clips, trackOrder, groups } = get();
    return {
      tracks: { ...tracks },
      clips: { ...clips },
      trackOrder: [...trackOrder],
      groups: { ...groups },
    };
  },

  _restoreTimeline: (snapshot) => {
    set({
      tracks: snapshot.tracks,
      clips: snapshot.clips,
      trackOrder: snapshot.trackOrder,
      groups: snapshot.groups ?? {},
    });
    get().recalculateDuration();
  },

  _pushHistory: (type, before, after) => {
    pushTimelineHistory(type, before, after);
  },

  // ─── Track Actions ───────────────────────────────────────────

  addTrack: (type, name) => {
    const before = get()._snapshotTimeline();
    const id = uuid();
    const { trackOrder } = get();
    const track: Track = {
      id,
      name: name ?? `${type.charAt(0).toUpperCase() + type.slice(1)} ${trackOrder.length + 1}`,
      type,
      order: trackOrder.length,
      height: type === 'audio' ? 60 : 80,
      muted: false,
      locked: false,
      visible: true,
    };
    set((s) => ({
      tracks: { ...s.tracks, [id]: track },
      trackOrder: [...s.trackOrder, id],
    }));
    pushTimelineHistory('addTrack', before, get()._snapshotTimeline());
    return id;
  },

  updateTrack: (trackId, updates) => {
    const before = get()._snapshotTimeline();
    set((s) => ({
      tracks: { ...s.tracks, [trackId]: { ...s.tracks[trackId], ...updates } },
    }));
    pushTimelineHistory('updateTrack', before, get()._snapshotTimeline());
  },

  removeTrack: (trackId) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const { [trackId]: _, ...remainingTracks } = s.tracks;
      // Remove all clips on this track
      const remainingClips: Record<string, Clip> = {};
      for (const [cid, clip] of Object.entries(s.clips)) {
        if (clip.trackId !== trackId) remainingClips[cid] = clip;
      }
      return {
        tracks: remainingTracks,
        clips: remainingClips,
        trackOrder: s.trackOrder.filter((id) => id !== trackId),
      };
    });
    pushTimelineHistory('removeTrack', before, get()._snapshotTimeline());
  },

  reorderTracks: (trackOrder) => {
    const before = get()._snapshotTimeline();
    set({ trackOrder });
    pushTimelineHistory('reorderTracks', before, get()._snapshotTimeline());
  },

  // ─── Clip Actions ────────────────────────────────────────────

  addClip: (clipData) => {
    const before = isSuppressed() ? null : get()._snapshotTimeline();
    const id = uuid();
    const clip: Clip = { animations: [], ...clipData, id };
    set((s) => {
      const updated = { ...s, clips: { ...s.clips, [id]: clip } };
      return updated;
    });
    get().recalculateDuration();
    if (!isSuppressed() && before) {
      pushTimelineHistory('addClip', before, get()._snapshotTimeline());
    }
    return id;
  },

  updateClip: (clipId, updates) => {
    const before = isSuppressed() ? null : get()._snapshotTimeline();
    set((s) => ({
      clips: {
        ...s.clips,
        [clipId]: { ...s.clips[clipId], ...updates },
      },
    }));
    get().recalculateDuration();
    if (!isSuppressed() && before) {
      pushTimelineHistory('updateClip', before, get()._snapshotTimeline());
    }
  },

  removeClip: (clipId) => {
    const before = isSuppressed() ? null : get()._snapshotTimeline();
    set((s) => {
      const { [clipId]: _, ...remaining } = s.clips;
      return { clips: remaining, selectedClipIds: s.selectedClipIds.filter((id) => id !== clipId) };
    });
    get().recalculateDuration();
    if (!isSuppressed() && before) {
      pushTimelineHistory('removeClip', before, get()._snapshotTimeline());
    }
  },

  moveClip: (clipId, trackId, startTime) => {
    const state = get();
    const clip = state.clips[clipId];
    if (!clip) return;

    // Collision detection: check for overlaps on target track
    const clipsOnTrack = state.getClipsOnTrack(trackId).filter((c) => c.id !== clipId);
    const wouldOverlap = clipsOnTrack.some(
      (c) => startTime < c.startTime + c.duration && startTime + clip.duration > c.startTime
    );
    if (wouldOverlap) return;

    const before = get()._snapshotTimeline();

    set((s) => ({
      clips: {
        ...s.clips,
        [clipId]: { ...clip, trackId, startTime: Math.max(0, startTime) },
      },
    }));

    // Sync attached children (suppress history for child updates)
    const delta = startTime - clip.startTime;
    const children = Object.values(state.clips).filter((c) => c.parentClipId === clipId);
    if (children.length > 0) {
      suppressHistory();
      for (const child of children) {
        get().updateClip(child.id, { startTime: child.startTime + delta });
      }
      restoreHistorySuppression();
    }
    get().recalculateDuration();
    pushTimelineHistory('moveClip', before, get()._snapshotTimeline());
  },

  splitClip: (clipId, splitTime) => {
    const clip = get().clips[clipId];
    if (!clip) return null;

    const relativeTime = splitTime - clip.startTime;
    if (relativeTime <= 0 || relativeTime >= clip.duration) return null;

    const before = isSuppressed() ? null : get()._snapshotTimeline();

    const clipA: Omit<Clip, 'id'> = {
      ...clip,
      duration: relativeTime,
      outPoint: clip.inPoint + relativeTime / clip.speed,
    };
    const clipB: Omit<Clip, 'id'> = {
      ...clip,
      startTime: splitTime,
      duration: clip.duration - relativeTime,
      inPoint: clip.inPoint + relativeTime / clip.speed,
    };

    suppressHistory();
    get().removeClip(clipId);
    const idA = get().addClip(clipA);
    const idB = get().addClip(clipB);
    restoreHistorySuppression();

    if (!isSuppressed() && before) {
      pushTimelineHistory('splitClip', before, get()._snapshotTimeline());
    }
    return [idA, idB];
  },

  // ─── Group Actions ───────────────────────────────────────────

  groupClips: (clipIds) => {
    if (clipIds.length < 2) return '';
    const before = get()._snapshotTimeline();
    const id = uuid();
    const groupCount = Object.keys(get().groups).length;
    const color = GROUP_COLORS[groupCount % GROUP_COLORS.length];
    const group: ClipGroup = { id, color };
    set((s) => {
      const updatedClips = { ...s.clips };
      for (const clipId of clipIds) {
        if (updatedClips[clipId]) {
          updatedClips[clipId] = { ...updatedClips[clipId], groupId: id };
        }
      }
      return { clips: updatedClips, groups: { ...s.groups, [id]: group } };
    });
    pushTimelineHistory('groupClips', before, get()._snapshotTimeline());
    return id;
  },

  ungroupClips: (groupId) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const updatedClips = { ...s.clips };
      for (const [cid, clip] of Object.entries(updatedClips)) {
        if (clip.groupId === groupId) {
          const { groupId: _, ...rest } = clip;
          updatedClips[cid] = rest as Clip;
        }
      }
      const { [groupId]: _, ...remainingGroups } = s.groups;
      return { clips: updatedClips, groups: remainingGroups };
    });
    pushTimelineHistory('ungroupClips', before, get()._snapshotTimeline());
  },

  removeGroup: (groupId) => {
    const before = get()._snapshotTimeline();
    const groupClipIds = new Set(
      Object.values(get().clips).filter((c) => c.groupId === groupId).map((c) => c.id)
    );
    set((s) => {
      const updatedClips: Record<string, Clip> = {};
      for (const [cid, clip] of Object.entries(s.clips)) {
        if (!groupClipIds.has(cid)) updatedClips[cid] = clip;
      }
      const { [groupId]: _, ...remainingGroups } = s.groups;
      return {
        clips: updatedClips,
        groups: remainingGroups,
        selectedClipIds: s.selectedClipIds.filter((id) => !groupClipIds.has(id)),
      };
    });
    get().recalculateDuration();
    pushTimelineHistory('removeGroup', before, get()._snapshotTimeline());
  },

  moveGroupClips: (groupId, leadClipId, newLeadStartTime) => {
    const state = get();
    const lead = state.clips[leadClipId];
    if (!lead) return;
    const delta = newLeadStartTime - lead.startTime;
    if (delta === 0) return;

    const groupClipsList = Object.values(state.clips).filter((c) => c.groupId === groupId);

    // Collision check: only against clips outside this group
    for (const clip of groupClipsList) {
      const newStart = Math.max(0, clip.startTime + delta);
      const others = state.getClipsOnTrack(clip.trackId).filter(
        (c) => c.id !== clip.id && c.groupId !== groupId
      );
      const wouldOverlap = others.some(
        (c) => newStart < c.startTime + c.duration && newStart + clip.duration > c.startTime
      );
      if (wouldOverlap) return;
    }

    const before = get()._snapshotTimeline();
    set((s) => {
      const updatedClips = { ...s.clips };
      for (const clip of groupClipsList) {
        updatedClips[clip.id] = { ...clip, startTime: Math.max(0, clip.startTime + delta) };
      }
      return { clips: updatedClips };
    });
    get().recalculateDuration();
    pushTimelineHistory('moveGroupClips', before, get()._snapshotTimeline());
  },

  // ─── Playback ────────────────────────────────────────────────

  setPlayheadTime: (time) => set({ playheadTime: Math.max(0, time) }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setScrollX: (scrollX) => set({ scrollX }),

  // ─── Selection ───────────────────────────────────────────────

  selectClip: (clipId, multi = false) => {
    set((s) => ({
      selectedClipIds: multi ? [...s.selectedClipIds, clipId] : [clipId],
    }));
  },

  selectTrack: (trackId) => {
    set((s) => ({
      selectedTrackId: s.selectedTrackId === trackId ? null : trackId,
    }));
  },

  deselectAll: () => set({ selectedClipIds: [], selectedTrackId: null }),

  // ─── Markers & In/Out Points ─────────────────────────────────

  addMarker: (time, label) => {
    const id = uuid();
    set((s) => ({ markers: [...s.markers, { id, time, label }] }));
    return id;
  },

  removeMarker: (markerId) => {
    set((s) => ({ markers: s.markers.filter((m) => m.id !== markerId) }));
  },

  updateMarker: (markerId, updates) => {
    set((s) => ({
      markers: s.markers.map((m) => (m.id === markerId ? { ...m, ...updates } : m)),
    }));
  },

  setInPoint: (time) => set({ inPoint: time }),
  setOutPoint: (time) => set({ outPoint: time }),

  // ─── Shuttle ─────────────────────────────────────────────────

  setShuttleSpeed: (speed) => set({ shuttleSpeed: speed }),

  setCropMode: (active) => set({ isCropMode: active }),

  // ─── Transitions ──────────────────────────────────────────

  insertTransition: (trackId, time, duration = 1, type = 'fade-black') => {
    const before = get()._snapshotTimeline();
    suppressHistory();
    const clipId = get().addClip({
      assetId: '',
      trackId,
      startTime: Math.max(0, time - duration / 2),
      duration,
      inPoint: 0,
      outPoint: duration,
      speed: 1,
      opacity: 1,
      volume: 0,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      filters: [],
      keyframes: [],
      blendMode: 'normal',
      transitionData: { type },
      locked: false,
      visible: true,
    });
    restoreHistorySuppression();
    pushTimelineHistory('insertTransition', before, get()._snapshotTimeline());
    return clipId;
  },

  // ─── Freeze Frame ───────────────────────────────────────────

  insertFreezeFrame: (clipId, duration) => {
    const state = get();
    const clip = state.clips[clipId];
    if (!clip) return null;

    const { playheadTime } = state;
    const relativeTime = playheadTime - clip.startTime;
    if (relativeTime <= 0 || relativeTime >= clip.duration) return null;

    const before = get()._snapshotTimeline();
    suppressHistory();

    // Calculate source time at the freeze point
    const sourceTime = clip.inPoint + relativeTime * clip.speed;

    // Split the clip at the playhead
    const splitResult = get().splitClip(clipId, playheadTime);
    if (!splitResult) {
      restoreHistorySuppression();
      return null;
    }

    const [idA, idB] = splitResult;

    // Get clip B and shift it forward by freeze duration
    const clipB = get().clips[idB];
    if (clipB) {
      get().updateClip(idB, { startTime: clipB.startTime + duration });
    }

    // Insert the freeze frame clip between A and B
    const clipA = get().clips[idA];
    if (!clipA) {
      restoreHistorySuppression();
      return null;
    }

    const freezeClipId = get().addClip({
      assetId: clip.assetId,
      trackId: clip.trackId,
      startTime: playheadTime,
      duration: duration,
      inPoint: sourceTime,
      outPoint: sourceTime + 0.001,
      speed: 1,
      opacity: clip.opacity,
      volume: 0,
      position: clip.position,
      scale: clip.scale,
      rotation: clip.rotation,
      filters: clip.filters,
      keyframes: [],
      blendMode: clip.blendMode,
      locked: false,
      visible: true,
      freezeFrame: { sourceTime },
    });

    restoreHistorySuppression();
    pushTimelineHistory('insertFreezeFrame', before, get()._snapshotTimeline());
    return freezeClipId;
  },

  // ─── Keyframe Actions ───────────────────────────────────────

  addKeyframe: (clipId, keyframeData) => {
    const before = get()._snapshotTimeline();
    const id = uuid();
    const keyframe: Keyframe = { ...keyframeData, id };
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      return {
        clips: {
          ...s.clips,
          [clipId]: { ...clip, keyframes: [...clip.keyframes, keyframe] },
        },
      };
    });
    pushTimelineHistory('addKeyframe', before, get()._snapshotTimeline());
    return id;
  },

  updateKeyframe: (clipId, keyframeId, updates) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      return {
        clips: {
          ...s.clips,
          [clipId]: {
            ...clip,
            keyframes: clip.keyframes.map((kf) =>
              kf.id === keyframeId ? { ...kf, ...updates } : kf
            ),
          },
        },
      };
    });
    pushTimelineHistory('updateKeyframe', before, get()._snapshotTimeline());
  },

  removeKeyframe: (clipId, keyframeId) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      return {
        clips: {
          ...s.clips,
          [clipId]: {
            ...clip,
            keyframes: clip.keyframes.filter((kf) => kf.id !== keyframeId),
          },
        },
      };
    });
    pushTimelineHistory('removeKeyframe', before, get()._snapshotTimeline());
  },

  setClipKeyframes: (clipId, keyframes) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      return {
        clips: {
          ...s.clips,
          [clipId]: { ...clip, keyframes },
        },
      };
    });
    pushTimelineHistory('setClipKeyframes', before, get()._snapshotTimeline());
  },

  // ─── Animations ────────────────────────────────────────────────

  addAnimation: (clipId, animData) => {
    const before = get()._snapshotTimeline();
    const id = uuid();
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      const animations = [...(clip.animations || []), { ...animData, id }];
      const keyframes = generateKeyframesFromAnimations(animations);
      return {
        clips: {
          ...s.clips,
          [clipId]: { ...clip, animations, keyframes },
        },
      };
    });
    pushTimelineHistory('addAnimation', before, get()._snapshotTimeline());
    return id;
  },

  updateAnimation: (clipId, animationId, updates) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      const animations = (clip.animations || []).map((a) =>
        a.id === animationId ? { ...a, ...updates } : a
      );
      const keyframes = generateKeyframesFromAnimations(animations);
      return {
        clips: {
          ...s.clips,
          [clipId]: { ...clip, animations, keyframes },
        },
      };
    });
    pushTimelineHistory('updateAnimation', before, get()._snapshotTimeline());
  },

  removeAnimation: (clipId, animationId) => {
    const before = get()._snapshotTimeline();
    set((s) => {
      const clip = s.clips[clipId];
      if (!clip) return s;
      const animations = (clip.animations || []).filter((a) => a.id !== animationId);
      const keyframes = generateKeyframesFromAnimations(animations);
      return {
        clips: {
          ...s.clips,
          [clipId]: { ...clip, animations, keyframes },
        },
      };
    });
    pushTimelineHistory('removeAnimation', before, get()._snapshotTimeline());
  },

  // ─── Computed ────────────────────────────────────────────────

  recalculateDuration: () => {
    const clips = Object.values(get().clips);
    const maxEnd = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
    set({ duration: maxEnd });
  },

  getClipsOnTrack: (trackId) => {
    return Object.values(get().clips).filter((c) => c.trackId === trackId);
  },

  getClipAtTime: (trackId, time) => {
    return get()
      .getClipsOnTrack(trackId)
      .find((c) => time >= c.startTime && time < c.startTime + c.duration);
  },
}));
