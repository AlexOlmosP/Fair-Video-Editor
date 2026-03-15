import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Clip, Track, TrackType, Keyframe, ClipAnimation, TransitionType } from './types';
import { generateKeyframesFromAnimations } from '@/engine/animation/presets';

interface TimelineState {
  // Data
  tracks: Record<string, Track>;
  clips: Record<string, Clip>;
  trackOrder: string[];

  // Playback
  playheadTime: number;
  isPlaying: boolean;
  duration: number;
  zoom: number;
  scrollX: number;

  // Selection
  selectedClipIds: string[];
  selectedTrackId: string | null;

  // Actions — Tracks
  addTrack: (type: TrackType, name?: string) => string;
  removeTrack: (trackId: string) => void;
  reorderTracks: (trackOrder: string[]) => void;

  // Actions — Clips
  addClip: (clip: Omit<Clip, 'id'>) => string;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  moveClip: (clipId: string, trackId: string, startTime: number) => void;
  splitClip: (clipId: string, splitTime: number) => [string, string] | null;

  // Actions — Playback
  setPlayheadTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setScrollX: (scrollX: number) => void;

  // Actions — Selection
  selectClip: (clipId: string, multi?: boolean) => void;
  selectTrack: (trackId: string) => void;
  deselectAll: () => void;

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

  // Computed
  recalculateDuration: () => void;
  getClipsOnTrack: (trackId: string) => Clip[];
  getClipAtTime: (trackId: string, time: number) => Clip | undefined;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  tracks: {},
  clips: {},
  trackOrder: [],
  playheadTime: 0,
  isPlaying: false,
  duration: 0,
  zoom: 1,
  scrollX: 0,
  selectedClipIds: [],
  selectedTrackId: null,

  // ─── Track Actions ───────────────────────────────────────────

  addTrack: (type, name) => {
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
    return id;
  },

  removeTrack: (trackId) => {
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
  },

  reorderTracks: (trackOrder) => set({ trackOrder }),

  // ─── Clip Actions ────────────────────────────────────────────

  addClip: (clipData) => {
    const id = uuid();
    const clip: Clip = { animations: [], ...clipData, id };
    set((s) => {
      const updated = { ...s, clips: { ...s.clips, [id]: clip } };
      return updated;
    });
    get().recalculateDuration();
    return id;
  },

  updateClip: (clipId, updates) => {
    set((s) => ({
      clips: {
        ...s.clips,
        [clipId]: { ...s.clips[clipId], ...updates },
      },
    }));
    get().recalculateDuration();
  },

  removeClip: (clipId) => {
    set((s) => {
      const { [clipId]: _, ...remaining } = s.clips;
      return { clips: remaining, selectedClipIds: s.selectedClipIds.filter((id) => id !== clipId) };
    });
    get().recalculateDuration();
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

    set((s) => ({
      clips: {
        ...s.clips,
        [clipId]: { ...clip, trackId, startTime: Math.max(0, startTime) },
      },
    }));

    // Sync attached children
    const delta = startTime - clip.startTime;
    const children = Object.values(state.clips).filter((c) => c.parentClipId === clipId);
    for (const child of children) {
      get().updateClip(child.id, { startTime: child.startTime + delta });
    }
    get().recalculateDuration();
  },

  splitClip: (clipId, splitTime) => {
    const clip = get().clips[clipId];
    if (!clip) return null;

    const relativeTime = splitTime - clip.startTime;
    if (relativeTime <= 0 || relativeTime >= clip.duration) return null;

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

    get().removeClip(clipId);
    const idA = get().addClip(clipA);
    const idB = get().addClip(clipB);
    return [idA, idB];
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

  // ─── Transitions ──────────────────────────────────────────

  insertTransition: (trackId, time, duration = 1, type = 'fade-black') => {
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

    // Calculate source time at the freeze point
    const sourceTime = clip.inPoint + relativeTime * clip.speed;

    // Split the clip at the playhead
    const splitResult = get().splitClip(clipId, playheadTime);
    if (!splitResult) return null;

    const [idA, idB] = splitResult;

    // Get clip B and shift it forward by freeze duration
    const clipB = get().clips[idB];
    if (clipB) {
      get().updateClip(idB, { startTime: clipB.startTime + duration });
    }

    // Insert the freeze frame clip between A and B
    const clipA = get().clips[idA];
    if (!clipA) return null;

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

    return freezeClipId;
  },

  // ─── Keyframe Actions ───────────────────────────────────────

  addKeyframe: (clipId, keyframeData) => {
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
    return id;
  },

  updateKeyframe: (clipId, keyframeId, updates) => {
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
  },

  removeKeyframe: (clipId, keyframeId) => {
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
  },

  setClipKeyframes: (clipId, keyframes) => {
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
  },

  // ─── Animations ────────────────────────────────────────────────

  addAnimation: (clipId, animData) => {
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
    return id;
  },

  updateAnimation: (clipId, animationId, updates) => {
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
  },

  removeAnimation: (clipId, animationId) => {
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
