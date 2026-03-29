'use client';

import React from 'react';
import { formatTimeLabel } from '@/lib/time';
import { useTimelineStore } from '@/store/useTimelineStore';

interface TimeRulerProps {
  pixelsPerSecond: number;
}

export function TimeRuler({ pixelsPerSecond }: TimeRulerProps) {
  const duration = useTimelineStore((s) => s.duration);
  const setPlayheadTime = useTimelineStore((s) => s.setPlayheadTime);
  const markers = useTimelineStore((s) => s.markers);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const addMarker = useTimelineStore((s) => s.addMarker);
  const removeMarker = useTimelineStore((s) => s.removeMarker);

  // Show at least 60 seconds or project duration + 10s buffer
  const visibleDuration = Math.max(60, duration + 10);

  // Determine tick interval based on zoom
  let interval = 1;
  if (pixelsPerSecond < 20) interval = 5;
  if (pixelsPerSecond < 10) interval = 10;
  if (pixelsPerSecond > 100) interval = 0.5;

  const ticks: number[] = [];
  for (let t = 0; t <= visibleDuration; t += interval) {
    ticks.push(t);
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setPlayheadTime(x / pixelsPerSecond);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    addMarker(x / pixelsPerSecond);
  };

  const showInOut = inPoint !== null && outPoint !== null && inPoint < outPoint;

  return (
    <div
      className="h-6 border-b border-[var(--border-color)] relative cursor-pointer flex-shrink-0 sticky top-0 bg-[var(--bg-secondary)] z-10"
      style={{ width: visibleDuration * pixelsPerSecond }}
      onMouseDown={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Tick marks */}
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute top-0 h-full flex flex-col items-center"
          style={{ left: t * pixelsPerSecond }}
        >
          <span className="text-[10px] text-[var(--text-muted)] mt-0.5 select-none">
            {formatTimeLabel(t)}
          </span>
          <div className="w-px flex-1 bg-[var(--border-color)] opacity-50" />
        </div>
      ))}

      {/* In/Out range highlight */}
      {showInOut && (
        <div
          className="absolute top-0 h-full bg-amber-400/15 pointer-events-none border-x border-amber-400/40"
          style={{
            left: inPoint! * pixelsPerSecond,
            width: (outPoint! - inPoint!) * pixelsPerSecond,
          }}
        />
      )}

      {/* In point marker */}
      {inPoint !== null && (
        <div
          className="absolute top-0 h-full pointer-events-none"
          style={{ left: inPoint * pixelsPerSecond }}
        >
          <div className="w-px h-full bg-green-400/80" />
          {/* Right-pointing flag */}
          <div
            className="absolute top-0 w-0 h-0"
            style={{
              borderTop: '8px solid #4ade80',
              borderRight: '8px solid transparent',
            }}
          />
          <span
            className="absolute top-0 left-1 text-[9px] text-green-400 select-none leading-tight"
            style={{ marginTop: 1 }}
          >
            I
          </span>
        </div>
      )}

      {/* Out point marker */}
      {outPoint !== null && (
        <div
          className="absolute top-0 h-full pointer-events-none"
          style={{ left: outPoint * pixelsPerSecond }}
        >
          <div className="w-px h-full bg-red-400/80" />
          {/* Left-pointing flag */}
          <div
            className="absolute top-0 -translate-x-full w-0 h-0"
            style={{
              borderTop: '8px solid #f87171',
              borderLeft: '8px solid transparent',
            }}
          />
          <span
            className="absolute top-0 -translate-x-full text-[9px] text-red-400 select-none leading-tight pr-1"
            style={{ marginTop: 1 }}
          >
            O
          </span>
        </div>
      )}

      {/* Timeline markers — right-click to remove */}
      {markers.map((marker) => (
        <div
          key={marker.id}
          className="absolute top-0 h-full cursor-pointer group z-10"
          style={{ left: marker.time * pixelsPerSecond }}
          title={marker.label ?? `Marker at ${formatTimeLabel(marker.time)}\nRight-click to remove`}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            removeMarker(marker.id);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Vertical line */}
          <div className="w-px h-full bg-amber-400/70 group-hover:bg-amber-300" />
          {/* Diamond-flag at top */}
          <div
            className="absolute -top-px -left-[5px] w-[11px] h-[11px] bg-amber-400 group-hover:bg-amber-300 rounded-sm rotate-45 origin-center"
            style={{ top: 0 }}
          />
          {/* Label */}
          {marker.label && (
            <span className="absolute top-3 left-2 text-[9px] text-amber-400 select-none whitespace-nowrap">
              {marker.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
