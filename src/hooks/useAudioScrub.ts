'use client';

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { getCachedAudioBuffer } from '@/lib/audioWaveform';

/** Duration of each scrub snippet in seconds. */
const SCRUB_SNIPPET_DURATION = 0.1;

/** Minimum milliseconds between successive scrub plays (throttle). */
const SCRUB_THROTTLE_MS = 80;

/**
 * Plays a brief audio snippet whenever the playhead is scrubbed while paused.
 * Uses cached AudioBuffers from decodeAndExtractPeaks (populated on asset import).
 * Throttled to avoid overlapping snippets.
 */
export function useAudioScrub() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastScrubMsRef = useRef<number>(0);
  const lastPlayheadRef = useRef<number>(-1);

  useEffect(() => {
    // Initialise AudioContext on first user interaction (browser autoplay policy)
    const initCtx = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      document.removeEventListener('click', initCtx);
      document.removeEventListener('keydown', initCtx);
    };
    document.addEventListener('click', initCtx);
    document.addEventListener('keydown', initCtx);

    const unsubscribe = useTimelineStore.subscribe((state) => {
      const { isPlaying, playheadTime, clips } = state;

      // Only fire while the user is scrubbing (not during normal playback)
      if (isPlaying) {
        lastPlayheadRef.current = playheadTime;
        return;
      }
      if (playheadTime === lastPlayheadRef.current) return;
      lastPlayheadRef.current = playheadTime;

      const ctx = audioContextRef.current;
      if (!ctx) return;

      // Throttle rapid scrub events
      const now = performance.now();
      if (now - lastScrubMsRef.current < SCRUB_THROTTLE_MS) return;
      lastScrubMsRef.current = now;

      // Find the first active audio/video clip at this playhead position
      const assets = useProjectStore.getState().assets;
      let targetClip = null;

      for (const clip of Object.values(clips)) {
        if (!clip.visible || clip.volume <= 0) continue;
        if (playheadTime < clip.startTime || playheadTime >= clip.startTime + clip.duration) continue;
        const asset = assets[clip.assetId];
        if (!asset || asset.type === 'image') continue;
        targetClip = clip;
        break;
      }

      if (!targetClip) return;

      const cachedBuffer = getCachedAudioBuffer(targetClip.assetId);
      if (!cachedBuffer) return; // Buffer not yet decoded — silent scrub

      // Stop the previous snippet before playing the next
      if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch { /* already stopped */ }
        currentSourceRef.current = null;
      }

      // Convert global timeline time → source media time
      const mediaTime =
        targetClip.inPoint + (playheadTime - targetClip.startTime) * targetClip.speed;
      const sampleRate = cachedBuffer.sampleRate;
      const offsetSamples = Math.max(0, Math.floor(mediaTime * sampleRate));
      const snippetSamples = Math.floor(SCRUB_SNIPPET_DURATION * sampleRate);
      const availableSamples = cachedBuffer.length - offsetSamples;

      if (availableSamples <= 0) return;

      const actualSamples = Math.min(snippetSamples, availableSamples);
      const snippetBuffer = ctx.createBuffer(
        cachedBuffer.numberOfChannels,
        actualSamples,
        sampleRate,
      );

      // Copy audio data into the snippet buffer
      for (let c = 0; c < cachedBuffer.numberOfChannels; c++) {
        const src = cachedBuffer.getChannelData(c);
        const dst = snippetBuffer.getChannelData(c);
        for (let i = 0; i < actualSamples; i++) {
          dst[i] = src[offsetSamples + i];
        }
      }

      // Apply short fade-in / fade-out to eliminate clicks at snippet boundaries
      const fadeLen = Math.min(Math.floor(sampleRate * 0.005), Math.floor(actualSamples / 4));
      if (fadeLen > 0) {
        for (let c = 0; c < snippetBuffer.numberOfChannels; c++) {
          const data = snippetBuffer.getChannelData(c);
          for (let i = 0; i < fadeLen; i++) {
            const t = i / fadeLen;
            data[i] *= t;
            data[actualSamples - 1 - i] *= t;
          }
        }
      }

      // Route through a gain node (half volume for subtle scrub feel)
      const gainNode = ctx.createGain();
      gainNode.gain.value = targetClip.volume * 0.5;
      gainNode.connect(ctx.destination);

      const source = ctx.createBufferSource();
      source.buffer = snippetBuffer;
      source.connect(gainNode);
      source.start();
      currentSourceRef.current = source;
    });

    return () => {
      unsubscribe();
      document.removeEventListener('click', initCtx);
      document.removeEventListener('keydown', initCtx);
      if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, []);
}
