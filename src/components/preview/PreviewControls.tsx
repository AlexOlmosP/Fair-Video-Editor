'use client';

import React from 'react';
import { usePlayback } from '@/hooks/usePlayback';
import { secondsToDisplay } from '@/lib/time';

export function PreviewControls() {
  const { playheadTime, isPlaying, duration, togglePlayback, skipBackward, skipForward } =
    usePlayback();

  return (
    <div className="flex items-center gap-4 flex-shrink-0">
      {/* Time Display */}
      <span className="text-xs text-zinc-400 font-mono w-20 text-right">
        {secondsToDisplay(playheadTime)}
      </span>

      {/* Transport Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => skipBackward(5)}
          className="p-2 rounded hover:bg-zinc-800 transition-colors"
          title="Skip backward 5s"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
          </svg>
        </button>

        <button
          onClick={togglePlayback}
          className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={() => skipForward(5)}
          className="p-2 rounded hover:bg-zinc-800 transition-colors"
          title="Skip forward 5s"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
          </svg>
        </button>
      </div>

      {/* Duration */}
      <span className="text-xs text-zinc-400 font-mono w-20">
        {secondsToDisplay(duration)}
      </span>
    </div>
  );
}
