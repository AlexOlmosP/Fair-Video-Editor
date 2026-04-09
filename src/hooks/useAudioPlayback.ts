'use client';

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useMediaStore } from '@/store/useMediaStore';
import { computeInternalTime } from '@/engine/animation/speedMapping';

/**
 * Manages audio playback synchronized to the timeline playhead.
 *
 * - Connects each video/audio element to a Web Audio gain node so we can
 *   control per-clip volume independently of the element's native volume.
 * - For HTMLAudioElement, this hook is the ONLY playback driver — it calls
 *   play()/pause() and syncs currentTime to the playhead.
 * - For HTMLVideoElement, PreviewPlayer.tsx handles play/pause/seek; here we
 *   only adjust the gain node so that volume changes still apply.
 */
export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const connectedRef = useRef<Set<string>>(new Set());
  const playingAudioRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Create AudioContext on first user interaction (browser autoplay policy)
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

      // 1. Connect any newly-imported video/audio elements to the audio graph
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

      // 2. Aggregate desired state per asset (multiple clips can share an asset)
      type Desired = { gain: number; time: number; speed: number };
      const desired = new Map<string, Desired>();

      for (const clip of Object.values(clips)) {
        if (!clip.visible) continue;
        const el = elements[clip.assetId];
        if (!el || (!(el instanceof HTMLVideoElement) && !(el instanceof HTMLAudioElement))) continue;

        const isActive =
          isPlaying &&
          playheadTime >= clip.startTime &&
          playheadTime < clip.startTime + clip.duration;
        if (!isActive) continue;

        const speedTooExtreme = clip.speed < 0.25 || clip.speed > 4;
        const wantGain = speedTooExtreme ? 0 : clip.volume;
        const wantTime = computeInternalTime(clip, playheadTime);
        const wantSpeed = Math.max(0.0625, Math.min(16, clip.speed || 1));

        const prev = desired.get(clip.assetId);
        if (!prev || wantGain > prev.gain) {
          desired.set(clip.assetId, { gain: wantGain, time: wantTime, speed: wantSpeed });
        }
      }

      // 3. Apply gain + drive audio element playback
      for (const [assetId, gainNode] of gainNodesRef.current) {
        const want = desired.get(assetId);
        const el = elements[assetId];

        // Always set gain (works for both audio and video elements)
        gainNode.gain.value = want?.gain ?? 0;

        // Only DRIVE playback for HTMLAudioElement — PreviewPlayer handles video
        if (!(el instanceof HTMLAudioElement)) continue;

        if (want && isPlaying) {
          // Active audio clip — ensure element is playing and synced
          if (el.paused) {
            try { el.currentTime = want.time; } catch { /* invalid time */ }
            el.playbackRate = want.speed;
            el.play().catch(() => {});
            playingAudioRef.current.add(assetId);
          } else {
            if (Math.abs(el.currentTime - want.time) > 0.3) {
              try { el.currentTime = want.time; } catch { /* invalid time */ }
            }
            if (Math.abs(el.playbackRate - want.speed) > 0.01) {
              el.playbackRate = want.speed;
            }
          }
        } else {
          // Inactive — pause the audio element
          if (!el.paused) {
            el.pause();
            playingAudioRef.current.delete(assetId);
          }
        }
      }

      // 4. Resume/suspend audio context with playback state
      if (isPlaying && !lastIsPlaying) {
        ctx.resume();
      } else if (!isPlaying && lastIsPlaying) {
        // Mute all gains and pause all audio elements when playback stops
        for (const gainNode of gainNodesRef.current.values()) {
          gainNode.gain.value = 0;
        }
        for (const assetId of playingAudioRef.current) {
          const el = elements[assetId];
          if (el instanceof HTMLAudioElement && !el.paused) {
            el.pause();
          }
        }
        playingAudioRef.current.clear();
      }
      lastIsPlaying = isPlaying;
    });

    return () => {
      unsubscribe();
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
      // Pause any audio elements still playing
      const els = useMediaStore.getState().elements;
      for (const assetId of playingAudioRef.current) {
        const el = els[assetId];
        if (el instanceof HTMLAudioElement && !el.paused) {
          el.pause();
        }
      }
      playingAudioRef.current.clear();
    };
  }, []);
}
