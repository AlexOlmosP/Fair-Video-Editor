'use client';

import React from 'react';
import { usePlayback } from '@/hooks/usePlayback';
import { useTimelineStore } from '@/store/useTimelineStore';
import { secondsToDisplay } from '@/lib/time';

export function PreviewControls() {
  const { playheadTime, isPlaying, duration, togglePlayback, skipBackward, skipForward } =
    usePlayback();
  const shuttleSpeed = useTimelineStore((s) => s.shuttleSpeed);

  return (
    <div className="flex items-center gap-3 flex-shrink-0 glass-panel rounded-full px-4 py-2">
      {/* Time Display */}
      <span className="text-[11px] text-[var(--text-muted)] font-mono w-[72px] text-right tabular-nums tracking-tight">
        {secondsToDisplay(playheadTime)}
      </span>

      {/* Shuttle Speed Indicator */}
      {shuttleSpeed !== 0 && (
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 tabular-nums">
          {shuttleSpeed < 0 ? `◀ ${Math.abs(shuttleSpeed)}×` : `▶ ${shuttleSpeed}×`}
        </span>
      )}

      {/* Transport Controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => skipBackward(5)}
          className="p-2 rounded-xl hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-icon-press"
          title="Skip backward 5s"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
          </svg>
        </button>

        <button
          onClick={togglePlayback}
          className="rounded-full bg-[var(--accent)] hover:bg-blue-400 text-white btn-press p-3 group"
          style={{ boxShadow: '0 2px 12px rgba(59, 130, 246, 0.3), inset 0 1px 1px rgba(255,255,255,0.15)' }}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={() => skipForward(5)}
          className="p-2 rounded-xl hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-icon-press"
          title="Skip forward 5s"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
          </svg>
        </button>
      </div>

      {/* Duration */}
      <span className="text-[11px] text-[var(--text-muted)] font-mono w-[72px] tabular-nums tracking-tight">
        {secondsToDisplay(duration)}
      </span>
    </div>
  );
}
