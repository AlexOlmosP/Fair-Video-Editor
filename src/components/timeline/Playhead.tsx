'use client';

import React, { useCallback } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';

interface PlayheadProps {
  pixelsPerSecond: number;
}

export function Playhead({ pixelsPerSecond }: PlayheadProps) {
  const playheadTime = useTimelineStore((s) => s.playheadTime);
  const left = playheadTime * pixelsPerSecond;

  const handleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Pause playback while scrubbing
    useTimelineStore.getState().setIsPlaying(false);

    const parentRect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();

    const updateTime = (clientX: number) => {
      const x = clientX - parentRect.left;
      const time = Math.max(0, x / pixelsPerSecond);
      useTimelineStore.getState().setPlayheadTime(time);
    };

    updateTime(e.clientX);

    const onMove = (me: MouseEvent) => updateTime(me.clientX);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pixelsPerSecond]);

  return (
    <div
      className="absolute top-0 bottom-0 z-20"
      style={{ left }}
    >
      {/* Wide invisible hit area for easy grabbing (20px wide) */}
      <div
        className="absolute -left-[10px] top-0 bottom-0 w-[20px] cursor-grab active:cursor-grabbing"
        onMouseDown={handleDrag}
      />

      {/* Playhead handle (top triangle — bigger and more visible) */}
      <div className="relative pointer-events-none">
        <div
          className="absolute -top-0 -translate-x-1/2 w-0 h-0"
          style={{
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '9px solid #ef4444',
          }}
        />
      </div>

      {/* Visible red line */}
      <div className="w-px h-full bg-red-500 -translate-x-1/2 pointer-events-none" />
    </div>
  );
}
