'use client';

import React, { useMemo, useState, useCallback, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { Clip } from './Clip';
import { AnimationSubTrack } from './AnimationSubTrack';
import type { Track as TrackType } from '@/store/types';
import { TRACK_COLORS, ANIMATION_SUBLANE_HEIGHT } from '@/lib/constants';

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
}

export function Track({ track, pixelsPerSecond }: TrackProps) {
  const allClips = useTimelineStore((s) => s.clips);
  const clips = useMemo(
    () =>
      Object.values(allClips)
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.startTime - b.startTime),
    [allClips, track.id]
  );
  const setPlayheadTime = useTimelineStore((s) => s.setPlayheadTime);
  const deselectAll = useTimelineStore((s) => s.deselectAll);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragSelectRect, setDragSelectRect] = useState<{ x1: number; x2: number } | null>(null);
  const dragStartRef = useRef<{ x: number; moved: boolean } | null>(null);

  const handleTrackMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only start drag-select from empty track area
    if (e.target !== e.currentTarget) return;
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    dragStartRef.current = { x: startX, moved: false };

    const onMove = (me: MouseEvent) => {
      const curX = me.clientX - rect.left;
      const drag = dragStartRef.current;
      if (!drag) return;
      if (Math.abs(curX - drag.x) > 5) drag.moved = true;
      if (drag.moved) {
        const x1 = Math.min(drag.x, curX);
        const x2 = Math.max(drag.x, curX);
        setDragSelectRect({ x1, x2 });

        // Select clips that overlap the drag range
        const t1 = x1 / pixelsPerSecond;
        const t2 = x2 / pixelsPerSecond;
        const clipsInRange = clips.filter((c) => {
          const clipEnd = c.startTime + c.duration;
          return c.startTime < t2 && clipEnd > t1;
        });

        // Replace selection with clips in range
        useTimelineStore.getState().deselectAll();
        clipsInRange.forEach((c) => selectClip(c.id, true));
      }
    };

    const onUp = (me: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragSelectRect(null);

      const drag = dragStartRef.current;
      dragStartRef.current = null;

      if (!drag?.moved) {
        // Simple click on empty area: move playhead, deselect
        const x = me.clientX - rect.left;
        setPlayheadTime(x / pixelsPerSecond);
        deselectAll();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clips, pixelsPerSecond, setPlayheadTime, deselectAll, selectClip]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasAsset = e.dataTransfer.types.includes('application/x-asset-id');
    if (!hasAsset) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const assetId = e.dataTransfer.getData('application/x-asset-id');
      const assetType = e.dataTransfer.getData('application/x-asset-type');
      const duration = parseFloat(e.dataTransfer.getData('application/x-asset-duration')) || 5;

      if (!assetId) return;

      // Check type compatibility
      const isAudioAsset = assetType === 'audio';
      const isAudioTrack = track.type === 'audio';
      if (isAudioAsset !== isAudioTrack) return;

      // Calculate drop time from x position
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const dropTime = Math.max(0, x / pixelsPerSecond);

      // For images that don't have a media element yet, register one
      const asset = useProjectStore.getState().assets[assetId];
      if (asset && asset.type === 'image' && !useMediaStore.getState().elements[assetId]) {
        const img = new Image();
        img.src = asset.src;
        useMediaStore.getState().register(assetId, img);
      }

      useTimelineStore.getState().addClip({
        assetId,
        trackId: track.id,
        startTime: dropTime,
        duration,
        inPoint: 0,
        outPoint: duration,
        speed: 1,
        opacity: 1,
        volume: assetType === 'video' || assetType === 'audio' ? 1 : 0,
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        filters: [],
        keyframes: [],
        blendMode: 'normal',
        locked: false,
        visible: true,
      });
    },
    [track.id, track.type, pixelsPerSecond]
  );

  const trackColor = TRACK_COLORS[track.type];
  const hasAnimations = clips.some((c) => (c.animations?.length ?? 0) > 0);
  const clipsWithAnimations = clips.filter((c) => (c.animations?.length ?? 0) > 0);

  // Find gaps between consecutive non-transition clips for "Add Transition" buttons
  const regularClips = clips.filter((c) => !c.transitionData);
  const gaps: { time: number; leftPx: number }[] = [];
  for (let i = 0; i < regularClips.length - 1; i++) {
    const clipA = regularClips[i];
    const clipB = regularClips[i + 1];
    const gapStart = clipA.startTime + clipA.duration;
    const gapSize = clipB.startTime - gapStart;
    // Show button if clips are adjacent or very close (gap < 2s)
    if (gapSize < 2) {
      const midTime = (gapStart + clipB.startTime) / 2;
      // Check no transition already exists at this spot
      const hasTransition = clips.some(
        (c) => c.transitionData && c.startTime < clipB.startTime && c.startTime + c.duration > gapStart - 0.5
      );
      if (!hasTransition) {
        gaps.push({ time: midTime, leftPx: midTime * pixelsPerSecond });
      }
    }
  }

  return (
    <div
      data-track-id={track.id}
      className={`relative border-b border-[var(--border-color)] group ${isDragOver ? 'bg-blue-500/10' : ''}`}
      style={{
        height: track.height + (hasAnimations ? ANIMATION_SUBLANE_HEIGHT : 0),
        opacity: track.visible ? 1 : 0.4,
      }}
      onMouseDown={handleTrackMouseDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Track background stripe */}
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ backgroundColor: trackColor }}
      />

      {/* Drop indicator */}
      {isDragOver && (
        <div className="absolute inset-0 border-2 border-dashed border-blue-500/50 rounded pointer-events-none z-10" />
      )}

      {/* Drag-select rectangle */}
      {dragSelectRect && (
        <div
          className="absolute top-0 bottom-0 bg-blue-500/15 border border-blue-500/40 rounded-sm pointer-events-none z-20"
          style={{ left: dragSelectRect.x1, width: dragSelectRect.x2 - dragSelectRect.x1 }}
        />
      )}

      {/* Clips */}
      {clips.map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          trackColor={trackColor}
          pixelsPerSecond={pixelsPerSecond}
        />
      ))}

      {/* Animation sub-tracks */}
      {clipsWithAnimations.map((clip) => (
        <AnimationSubTrack
          key={`anim-${clip.id}`}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
        />
      ))}

      {/* Transition insertion buttons between clips */}
      {gaps.map((gap, i) => (
        <button
          key={i}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 w-5 h-5 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--accent)] text-[var(--text-secondary)] hover:text-white flex items-center justify-center text-xs transition-all opacity-0 hover:opacity-100 group-hover:opacity-60 btn-icon-press"
          style={{ left: gap.leftPx }}
          title="Add transition"
          onClick={(e) => {
            e.stopPropagation();
            useTimelineStore.getState().insertTransition(track.id, gap.time, 1, 'fade-black');
          }}
        >
          +
        </button>
      ))}
    </div>
  );
}
