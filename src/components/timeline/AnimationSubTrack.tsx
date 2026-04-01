'use client';

import React, { useRef, useCallback } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import type { Clip as ClipType, ClipAnimation } from '@/store/types';
import { ANIMATION_SUBLANE_HEIGHT } from '@/lib/constants';

interface AnimationSubTrackProps {
  clip: ClipType;
  pixelsPerSecond: number;
}

const ANIM_COLORS: Record<string, string> = {
  'zoom-in': '#3b82f6',
  'zoom-out': '#8b5cf6',
  'ken-burns': '#06b6d4',
  'spin-360': '#f59e0b',
  'fade-in': '#22c55e',
  'fade-out': '#ef4444',
  'bounce': '#ec4899',
};

type DragMode = 'move' | 'trim-left' | 'trim-right';

interface DragState {
  animId: string;
  mode: DragMode;
  startMouseX: number;
  origStart: number;
  origEnd: number;
}

export function AnimationSubTrack({ clip, pixelsPerSecond }: AnimationSubTrackProps) {
  const dragRef = useRef<DragState | null>(null);
  const updateAnimation = useTimelineStore((s) => s.updateAnimation);
  const removeAnimation = useTimelineStore((s) => s.removeAnimation);
  const animations = clip.animations || [];

  const clipDuration = clip.duration;

  const onMouseDown = useCallback(
    (e: React.MouseEvent, anim: ClipAnimation, mode: DragMode) => {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        animId: anim.id,
        mode,
        startMouseX: e.clientX,
        origStart: anim.startTime,
        origEnd: anim.endTime,
      };

      const onMouseMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;

        const deltaPx = ev.clientX - drag.startMouseX;
        const deltaTime = deltaPx / pixelsPerSecond;
        const minDuration = 0.1;

        if (drag.mode === 'move') {
          const duration = drag.origEnd - drag.origStart;
          let newStart = drag.origStart + deltaTime;
          newStart = Math.max(0, Math.min(clipDuration - duration, newStart));
          updateAnimation(clip.id, drag.animId, {
            startTime: newStart,
            endTime: newStart + duration,
          });
        } else if (drag.mode === 'trim-left') {
          let newStart = drag.origStart + deltaTime;
          newStart = Math.max(0, Math.min(drag.origEnd - minDuration, newStart));
          updateAnimation(clip.id, drag.animId, { startTime: newStart });
        } else if (drag.mode === 'trim-right') {
          let newEnd = drag.origEnd + deltaTime;
          newEnd = Math.max(drag.origStart + minDuration, Math.min(clipDuration, newEnd));
          updateAnimation(clip.id, drag.animId, { endTime: newEnd });
        }
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [clip.id, clipDuration, pixelsPerSecond, updateAnimation]
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent, anim: ClipAnimation) => {
      e.preventDefault();
      e.stopPropagation();
      removeAnimation(clip.id, anim.id);
    },
    [clip.id, removeAnimation]
  );

  if (animations.length === 0) return null;

  return (
    <div
      className="absolute inset-0"
      style={{
        height: ANIMATION_SUBLANE_HEIGHT,
        borderTop: '1px solid var(--border-color)',
        background: 'var(--hover-bg)',
      }}
    >
      {/* FX label */}
      <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-[var(--text-muted)] opacity-40 pointer-events-none select-none tracking-wider">
        FX
      </span>

      {animations.map((anim) => {
        const left = (clip.startTime + anim.startTime) * pixelsPerSecond;
        const width = Math.max(12, (anim.endTime - anim.startTime) * pixelsPerSecond);
        const color = ANIM_COLORS[anim.presetId] || '#6b7280';

        return (
          <div
            key={anim.id}
            className="absolute top-1 rounded-md flex items-center overflow-hidden select-none group"
            style={{
              left,
              width,
              height: ANIMATION_SUBLANE_HEIGHT - 8,
              backgroundColor: `${color}25`,
              border: `1px solid ${color}60`,
              cursor: 'grab',
            }}
            onMouseDown={(e) => onMouseDown(e, anim, 'move')}
            onContextMenu={(e) => onContextMenu(e, anim)}
          >
            {/* Left trim handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/20 z-10 rounded-l-md"
              onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, anim, 'trim-left'); }}
            />
            {/* Label */}
            <span
              className="text-[10px] font-medium px-2 truncate pointer-events-none"
              style={{ color }}
            >
              {anim.presetLabel}
            </span>
            {/* Right trim handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/20 z-10 rounded-r-md"
              onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, anim, 'trim-right'); }}
            />
          </div>
        );
      })}
    </div>
  );
}
