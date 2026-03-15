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

  return (
    <div
      className="h-6 border-b border-zinc-800 relative cursor-pointer flex-shrink-0 sticky top-0 bg-zinc-900 z-10"
      style={{ width: visibleDuration * pixelsPerSecond }}
      onClick={handleClick}
    >
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute top-0 h-full flex flex-col items-center"
          style={{ left: t * pixelsPerSecond }}
        >
          <span className="text-[10px] text-zinc-500 mt-0.5 select-none">
            {formatTimeLabel(t)}
          </span>
          <div className="w-px flex-1 bg-zinc-700 opacity-50" />
        </div>
      ))}
    </div>
  );
}
