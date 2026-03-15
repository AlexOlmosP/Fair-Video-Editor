'use client';

import React from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import type { Keyframe } from '@/store/types';

interface KeyframeEditorProps {
  clipId: string;
  property: string;
  currentValue: number;
}

export function KeyframeToggle({ clipId, property, currentValue }: KeyframeEditorProps) {
  const clip = useTimelineStore((s) => s.clips[clipId]);
  const playheadTime = useTimelineStore((s) => s.playheadTime);
  const addKeyframe = useTimelineStore((s) => s.addKeyframe);
  const removeKeyframe = useTimelineStore((s) => s.removeKeyframe);

  if (!clip) return null;

  const clipLocalTime = (playheadTime - clip.startTime) * clip.speed;
  const propertyKeyframes = clip.keyframes.filter((kf) => kf.property === property);
  const hasKeyframes = propertyKeyframes.length > 0;

  // Check if there's a keyframe at the current time (within 0.05s tolerance)
  const kfAtTime = propertyKeyframes.find(
    (kf) => Math.abs(kf.time - clipLocalTime) < 0.05
  );

  const handleClick = () => {
    if (kfAtTime) {
      removeKeyframe(clipId, kfAtTime.id);
    } else {
      addKeyframe(clipId, {
        time: clipLocalTime,
        property,
        value: currentValue,
        easing: 'ease-in-out',
      });
    }
  };

  // Diamond icon states
  let diamondClass = 'text-zinc-600 hover:text-zinc-400'; // no keyframes
  if (kfAtTime) {
    diamondClass = 'text-yellow-400'; // keyframe at current time
  } else if (hasKeyframes) {
    diamondClass = 'text-yellow-400/50 hover:text-yellow-400'; // has keyframes, not at current time
  }

  return (
    <button
      onClick={handleClick}
      className={`w-4 h-4 flex items-center justify-center transition-colors ${diamondClass}`}
      title={kfAtTime ? 'Remove keyframe' : 'Add keyframe at playhead'}
    >
      <svg viewBox="0 0 12 12" className="w-3 h-3" fill={kfAtTime ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5}>
        <path d="M6 1 L11 6 L6 11 L1 6 Z" />
      </svg>
    </button>
  );
}

interface KeyframeStripProps {
  clipId: string;
  property: string;
}

export function KeyframeStrip({ clipId, property }: KeyframeStripProps) {
  const clip = useTimelineStore((s) => s.clips[clipId]);
  if (!clip) return null;

  const keyframes = clip.keyframes.filter((kf) => kf.property === property);
  if (keyframes.length === 0) return null;

  const clipDuration = clip.outPoint - clip.inPoint;

  return (
    <div className="relative h-3 bg-zinc-800 rounded mt-0.5">
      {keyframes.map((kf) => {
        const pos = clipDuration > 0 ? (kf.time / clipDuration) * 100 : 0;
        return (
          <div
            key={kf.id}
            className="absolute top-0.5 w-2 h-2 bg-yellow-400 rotate-45"
            style={{ left: `calc(${pos}% - 4px)` }}
            title={`${kf.property} @ ${kf.time.toFixed(2)}s = ${kf.value.toFixed(2)} (${kf.easing})`}
          />
        );
      })}
    </div>
  );
}
