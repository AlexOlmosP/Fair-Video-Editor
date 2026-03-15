'use client';

import React, { useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { Track } from './Track';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { PIXELS_PER_SECOND_BASE, DEFAULT_TRACKS } from '@/lib/constants';

export function Timeline() {
  const { trackOrder, tracks, zoom, addTrack, selectedTrackId } = useTimelineStore();

  // Initialize default tracks on first mount
  useEffect(() => {
    if (trackOrder.length === 0) {
      for (const t of DEFAULT_TRACKS) {
        addTrack(t.type, t.name);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pixelsPerSecond = PIXELS_PER_SECOND_BASE * zoom;

  return (
    <div className="flex flex-col h-full">
      {/* Timeline Header with controls */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => addTrack('video')}
            className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            + Video Track
          </button>
          <button
            onClick={() => addTrack('audio')}
            className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            + Audio Track
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Zoom</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={zoom}
            onChange={(e) => useTimelineStore.getState().setZoom(parseFloat(e.target.value))}
            className="w-24 h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-blue-500"
          />
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Track Labels */}
        <div className="w-36 flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          {/* Ruler spacer */}
          <div className="h-6 border-b border-zinc-800" />
          {trackOrder.map((trackId) => {
            const track = tracks[trackId];
            if (!track) return null;
            const isSelected = selectedTrackId === trackId;
            return (
              <div
                key={trackId}
                onClick={() => useTimelineStore.getState().selectTrack(trackId)}
                className={`flex items-center px-2 border-b border-zinc-800 text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'text-white bg-blue-600/20 border-l-2 border-l-blue-500'
                    : 'text-zinc-400 hover:bg-zinc-800/50'
                }`}
                style={{ height: track.height }}
              >
                <span className="truncate">{track.name}</span>
              </div>
            );
          })}
        </div>

        {/* Scrollable Timeline Area */}
        <div className="flex-1 overflow-auto relative">
          {/* Time Ruler */}
          <TimeRuler pixelsPerSecond={pixelsPerSecond} />

          {/* Tracks */}
          <div className="relative">
            <Playhead pixelsPerSecond={pixelsPerSecond} />
            {trackOrder.map((trackId) => {
              const track = tracks[trackId];
              if (!track) return null;
              return (
                <Track
                  key={trackId}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
