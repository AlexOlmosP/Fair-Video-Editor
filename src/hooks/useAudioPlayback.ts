'use client';

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';

/**
 * Manages audio playback synchronized to the timeline playhead.
 * Creates AudioContext + MediaElementSource for each video/audio clip.
 */
export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const connectedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Create AudioContext on first user interaction
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };

    document.addEventListener('click', initAudio);
    document.addEventListener('keydown', initAudio);

    let lastIsPlaying = false;

    const unsubscribe = useTimelineStore.subscribe((state) => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const { clips, playheadTime, isPlaying } = state;
      const elements = useMediaStore.getState().elements;

      // Connect new video/audio elements to audio graph
      for (const clip of Object.values(clips)) {
        const el = elements[clip.assetId];
        if (!el || (!(el instanceof HTMLVideoElement) && !(el instanceof HTMLAudioElement))) continue;
        if (connectedRef.current.has(clip.assetId)) continue;

        try {
          const source = ctx.createMediaElementSource(el);
          const gainNode = ctx.createGain();
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
          gainNodesRef.current.set(clip.assetId, gainNode);
          connectedRef.current.add(clip.assetId);
        } catch {
          // Already connected or not ready
        }
      }

      // Update gain (volume) and playback rate for active clips
      for (const clip of Object.values(clips)) {
        const gainNode = gainNodesRef.current.get(clip.assetId);
        if (!gainNode) continue;

        const el = elements[clip.assetId];
        const isActive =
          isPlaying &&
          clip.visible &&
          playheadTime >= clip.startTime &&
          playheadTime < clip.startTime + clip.duration;

        // Mute audio at extreme speeds where it sounds bad
        const speedTooExtreme = clip.speed < 0.25 || clip.speed > 4;
        gainNode.gain.value = isActive && !speedTooExtreme ? clip.volume : 0;

        // Sync playback rate for moderate speeds
        if ((el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) && isActive) {
          const clampedSpeed = Math.max(0.0625, Math.min(16, clip.speed));
          if (Math.abs(el.playbackRate - clampedSpeed) > 0.01) {
            el.playbackRate = clampedSpeed;
          }
        }
      }

      // Resume/suspend audio context with playback
      if (isPlaying && !lastIsPlaying) {
        ctx.resume();
      } else if (!isPlaying && lastIsPlaying) {
        // Mute all when paused
        for (const gainNode of gainNodesRef.current.values()) {
          gainNode.gain.value = 0;
        }
      }
      lastIsPlaying = isPlaying;
    });

    return () => {
      unsubscribe();
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
  }, []);
}
