'use client';

import { useCallback } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';

/**
 * Playback controls — no RAF loop here.
 * The PreviewPlayer owns the single RAF loop that both advances the
 * playhead and renders the frame in one tick.
 */
export function usePlayback() {
  const {
    playheadTime,
    isPlaying,
    duration,
    setPlayheadTime,
    setIsPlaying,
  } = useTimelineStore();

  const play = useCallback(() => {
    setIsPlaying(true);
  }, [setIsPlaying]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, [setIsPlaying]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      // If at end, restart from beginning
      if (playheadTime >= duration && duration > 0) {
        setPlayheadTime(0);
      }
      play();
    }
  }, [isPlaying, playheadTime, duration, play, pause, setPlayheadTime]);

  const seek = useCallback((time: number) => {
    setPlayheadTime(Math.max(0, Math.min(time, duration)));
  }, [setPlayheadTime, duration]);

  const skipForward = useCallback((seconds: number = 5) => {
    seek(playheadTime + seconds);
  }, [playheadTime, seek]);

  const skipBackward = useCallback((seconds: number = 5) => {
    seek(playheadTime - seconds);
  }, [playheadTime, seek]);

  return {
    playheadTime,
    isPlaying,
    duration,
    play,
    pause,
    togglePlayback,
    seek,
    skipForward,
    skipBackward,
  };
}
