'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { Track } from './Track';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { PIXELS_PER_SECOND_BASE, DEFAULT_TRACKS } from '@/lib/constants';

// ─── Inline SVG icons for track controls ──────────────────────────────────────

function EyeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

export function Timeline() {
  const { trackOrder, tracks, zoom, duration, isPlaying, playheadTime, addTrack, selectedTrackId } = useTimelineStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize default tracks on first mount
  useEffect(() => {
    if (trackOrder.length === 0) {
      for (const t of DEFAULT_TRACKS) {
        addTrack(t.type, t.name);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pixelsPerSecond = PIXELS_PER_SECOND_BASE * zoom;

  // ── Zoom to Fit ──────────────────────────────────────────────────────────────
  const zoomToFit = useCallback(() => {
    if (!scrollRef.current || duration <= 0) return;
    const containerWidth = scrollRef.current.clientWidth;
    const newZoom = containerWidth / (duration * PIXELS_PER_SECOND_BASE);
    useTimelineStore.getState().setZoom(Math.max(0.1, Math.min(10, newZoom)));
    scrollRef.current.scrollLeft = 0;
    useTimelineStore.getState().setScrollX(0);
  }, [duration]);

  // ── Auto-scroll to follow playhead during playback ───────────────────────────
  useEffect(() => {
    if (!isPlaying || !scrollRef.current) return;
    const container = scrollRef.current;
    const playheadPx = playheadTime * pixelsPerSecond;
    const { scrollLeft, clientWidth } = container;
    // If playhead exits the visible area, scroll to keep it at ~20% from left
    if (playheadPx < scrollLeft || playheadPx > scrollLeft + clientWidth) {
      container.scrollLeft = Math.max(0, playheadPx - clientWidth * 0.2);
    }
  }, [playheadTime, isPlaying, pixelsPerSecond]);

  return (
    <div className="flex flex-col h-full">
      {/* Timeline Header with controls */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-color)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => addTrack('video')}
            className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] rounded-lg transition-colors btn-press"
          >
            + Video Track
          </button>
          <button
            onClick={() => addTrack('audio')}
            className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] rounded-lg transition-colors btn-press"
          >
            + Audio Track
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom to Fit button */}
          <button
            onClick={zoomToFit}
            disabled={duration <= 0}
            className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] rounded-lg transition-colors btn-press disabled:opacity-40 disabled:cursor-not-allowed"
            title="Zoom to fit all clips"
          >
            Fit
          </button>
          <span className="text-xs text-[var(--text-muted)]">Zoom</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={zoom}
            onChange={(e) => useTimelineStore.getState().setZoom(parseFloat(e.target.value))}
            onDoubleClick={zoomToFit}
            className="w-24 h-1 bg-[var(--hover-bg)] rounded appearance-none cursor-pointer accent-blue-500"
            title="Zoom (double-click to fit)"
          />
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Track Labels */}
        <div className="w-36 flex-shrink-0 border-r border-[var(--border-color)] overflow-y-auto">
          {/* Ruler spacer */}
          <div className="h-6 border-b border-[var(--border-color)]" />
          {trackOrder.map((trackId) => {
            const track = tracks[trackId];
            if (!track) return null;
            const isSelected = selectedTrackId === trackId;
            return (
              <div
                key={trackId}
                onClick={() => useTimelineStore.getState().selectTrack(trackId)}
                className={`flex items-center px-2 gap-1 border-b border-[var(--border-color)] text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'text-white bg-blue-600/20 border-l-2 border-l-blue-500'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/50'
                }`}
                style={{ height: track.height }}
              >
                {/* Track name */}
                <span className="truncate flex-1 min-w-0">{track.name}</span>

                {/* Track control icons */}
                <div
                  className="flex items-center gap-0.5 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Eye — visibility */}
                  <button
                    title={track.visible ? 'Hide track' : 'Show track'}
                    onClick={() => useTimelineStore.getState().updateTrack(trackId, { visible: !track.visible })}
                    className={`p-0.5 rounded transition-colors hover:bg-[var(--hover-bg)] ${
                      track.visible ? 'text-[var(--text-muted)]' : 'text-amber-400'
                    }`}
                  >
                    {track.visible ? <EyeIcon /> : <EyeOffIcon />}
                  </button>

                  {/* Lock */}
                  <button
                    title={track.locked ? 'Unlock track' : 'Lock track'}
                    onClick={() => useTimelineStore.getState().updateTrack(trackId, { locked: !track.locked })}
                    className={`p-0.5 rounded transition-colors hover:bg-[var(--hover-bg)] ${
                      track.locked ? 'text-amber-400' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {track.locked ? <LockIcon /> : <UnlockIcon />}
                  </button>

                  {/* Speaker — mute (only meaningful for audio/video tracks) */}
                  {(track.type === 'audio' || track.type === 'video') && (
                    <button
                      title={track.muted ? 'Unmute track' : 'Mute track'}
                      onClick={() => useTimelineStore.getState().updateTrack(trackId, { muted: !track.muted })}
                      className={`p-0.5 rounded transition-colors hover:bg-[var(--hover-bg)] ${
                        track.muted ? 'text-red-400' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {track.muted ? <MuteIcon /> : <SpeakerIcon />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scrollable Timeline Area */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative">
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
