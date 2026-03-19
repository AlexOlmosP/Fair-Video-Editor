'use client';

import React, { useCallback, useState, useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { ClipContextMenu } from './ClipContextMenu';
import type { Clip as ClipType } from '@/store/types';
import { MIN_CLIP_DURATION, SNAP_THRESHOLD_PX } from '@/lib/constants';

/** Collect all clip edge times across all tracks (except the given clip) */
function getSnapEdges(excludeClipId: string): number[] {
  const { clips } = useTimelineStore.getState();
  const edges: number[] = [0]; // always snap to timeline start
  for (const c of Object.values(clips)) {
    if (c.id === excludeClipId) continue;
    edges.push(c.startTime, c.startTime + c.duration);
  }
  return edges;
}

/** Snap a time value to the nearest edge if within threshold (in seconds) */
function snapTime(time: number, edges: number[], thresholdSeconds: number): number {
  let best = time;
  let bestDist = Infinity;
  for (const edge of edges) {
    const dist = Math.abs(time - edge);
    if (dist < thresholdSeconds && dist < bestDist) {
      best = edge;
      bestDist = dist;
    }
  }
  return best;
}

interface ClipProps {
  clip: ClipType;
  trackColor: string;
  pixelsPerSecond: number;
}

export function Clip({ clip, trackColor, pixelsPerSecond }: ClipProps) {
  const selectClip = useTimelineStore((s) => s.selectClip);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const moveClip = useTimelineStore((s) => s.moveClip);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const assets = useProjectStore((s) => s.assets);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  const isSelected = selectedClipIds.includes(clip.id);
  const asset = assets[clip.assetId];
  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;

  // Generate thumbnail strip for video clips
  useEffect(() => {
    if (!asset || asset.type !== 'video') return;

    const thumbCount = Math.max(1, Math.min(8, Math.floor(width / 60)));
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 45;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const thumbs: string[] = new Array(thumbCount).fill('');
    let completed = 0;

    for (let i = 0; i < thumbCount; i++) {
      const time = clip.inPoint + (clip.duration / thumbCount) * (i + 0.5) / clip.speed;
      const vid = document.createElement('video');
      vid.src = asset.src;
      vid.preload = 'auto';
      vid.muted = true;
      vid.currentTime = Math.max(0, time);
      vid.onseeked = () => {
        ctx.drawImage(vid, 0, 0, 80, 45);
        thumbs[i] = canvas.toDataURL('image/jpeg', 0.4);
        completed++;
        if (completed === thumbCount) {
          setThumbnails([...thumbs]);
        }
        vid.remove();
      };
      vid.onerror = () => {
        completed++;
        if (completed === thumbCount) setThumbnails([...thumbs]);
        vid.remove();
      };
    }

    return () => { setThumbnails([]); };
  }, [clip.assetId, clip.inPoint, clip.speed, asset?.src, asset?.type,
      // Re-generate only when width changes significantly (avoids thrashing during trim)
      Math.floor(width / 60)]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    if (target.dataset.trimHandle) return;

    selectClip(clip.id, e.shiftKey);

    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = clip.startTime;
    const origTrackId = clip.trackId;
    const edges = getSnapEdges(clip.id);
    const snapThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond;

    const onMove = (me: MouseEvent) => {
      const deltaX = me.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newStartTime = Math.max(0, startTime + deltaTime);
      const clipEnd = newStartTime + clip.duration;

      // Snap start edge
      const snappedStart = snapTime(newStartTime, edges, snapThreshold);
      if (snappedStart !== newStartTime) {
        newStartTime = snappedStart;
      } else {
        // Snap end edge
        const snappedEnd = snapTime(clipEnd, edges, snapThreshold);
        if (snappedEnd !== clipEnd) {
          newStartTime = snappedEnd - clip.duration;
        }
      }

      // Cross-track drag: find track under cursor via data-track-id
      let targetTrackId = origTrackId;
      if (Math.abs(me.clientY - startY) > 15) {
        const trackEls = document.querySelectorAll('[data-track-id]');
        for (const el of trackEls) {
          const rect = el.getBoundingClientRect();
          if (me.clientY >= rect.top && me.clientY <= rect.bottom) {
            targetTrackId = el.getAttribute('data-track-id') || origTrackId;
            break;
          }
        }
      }

      moveClip(clip.id, targetTrackId, Math.max(0, newStartTime));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clip.id, clip.startTime, clip.trackId, selectClip, moveClip, pixelsPerSecond]);

  const handleTrimLeft = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);

    const startX = e.clientX;
    const origStartTime = clip.startTime;
    const origDuration = clip.duration;
    const origInPoint = clip.inPoint;
    const edges = getSnapEdges(clip.id);
    const snapThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond;

    const onMove = (me: MouseEvent) => {
      const deltaX = me.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newStartTime = Math.max(0, origStartTime + deltaTime);

      // Snap left edge to nearby clip edges
      newStartTime = snapTime(newStartTime, edges, snapThreshold);

      const trimAmount = newStartTime - origStartTime;
      const newDuration = origDuration - trimAmount;

      if (newDuration >= MIN_CLIP_DURATION) {
        updateClip(clip.id, {
          startTime: newStartTime,
          duration: newDuration,
          inPoint: origInPoint + trimAmount / clip.speed,
        });
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clip, selectClip, updateClip, pixelsPerSecond]);

  const handleTrimRight = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);

    const startX = e.clientX;
    const origDuration = clip.duration;
    const origOutPoint = clip.outPoint;
    const origStartTime = clip.startTime;
    const edges = getSnapEdges(clip.id);
    const snapThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond;

    const onMove = (me: MouseEvent) => {
      const deltaX = me.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newEndTime = origStartTime + origDuration + deltaTime;

      // Snap right edge to nearby clip edges
      newEndTime = snapTime(newEndTime, edges, snapThreshold);

      const newDuration = Math.max(MIN_CLIP_DURATION, newEndTime - origStartTime);
      const durationDelta = newDuration - origDuration;

      updateClip(clip.id, {
        duration: newDuration,
        outPoint: origOutPoint + durationDelta / clip.speed,
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clip, selectClip, updateClip, pixelsPerSecond]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.id);
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [clip.id, selectClip]);

  const isAudio = asset?.type === 'audio';
  const isTransition = !!clip.transitionData;

  return (
    <>
      <div
        className={`absolute top-1 bottom-1 rounded-lg cursor-grab active:cursor-grabbing select-none overflow-hidden transition-shadow ${
          isSelected ? 'ring-2 ring-[var(--accent)]/70 shadow-lg' : 'hover:brightness-110'
        }`}
        style={{
          left,
          width: Math.max(width, 4),
          backgroundColor: isTransition ? '#1e1e2e' : trackColor,
          opacity: clip.locked ? 0.6 : clip.visible ? 1 : 0.3,
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        {/* Transition gradient overlay */}
        {isTransition && (
          <div className="absolute inset-0 flex overflow-hidden rounded">
            <div className="flex-1" style={{
              background: `linear-gradient(to right, transparent, ${clip.transitionData!.type === 'fade-white' ? '#fff' : '#000'})`,
            }} />
            <div className="flex-1" style={{
              background: `linear-gradient(to right, ${clip.transitionData!.type === 'fade-white' ? '#fff' : '#000'}, transparent)`,
            }} />
          </div>
        )}

        {/* Thumbnail strip — fully opaque, no color tint */}
        {!isTransition && thumbnails.length > 0 && (
          <div className="absolute inset-0 flex">
            {thumbnails.map((thumb, i) => (
              <div key={i} className="flex-1 h-full overflow-hidden">
                {thumb && (
                  <img src={thumb} alt="" className="w-full h-full object-cover brightness-[0.7]" draggable={false} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Audio waveform placeholder */}
        {isAudio && (
          <div className="absolute inset-0 flex items-center px-1 opacity-30">
            {Array.from({ length: Math.max(1, Math.floor(width / 3)) }).map((_, i) => (
              <div
                key={i}
                className="w-0.5 mx-px bg-white rounded-full"
                style={{ height: `${20 + Math.sin(i * 0.7) * 30 + Math.sin(i * 1.3) * 20}%` }}
              />
            ))}
          </div>
        )}

        {/* Clip Label */}
        <div className="relative z-10 flex items-center h-full">
          <span className="px-2 text-xs text-white/90 truncate font-medium pointer-events-none drop-shadow-sm">
            {isTransition
              ? `${clip.transitionData!.type.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
              : asset?.name ?? 'Clip'}
          </span>
        </div>

        {/* Duration label */}
        {width > 80 && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/50 pointer-events-none z-10">
            {clip.duration.toFixed(1)}s
          </span>
        )}

        {/* Lock indicator */}
        {clip.locked && (
          <div className="absolute top-0.5 right-0.5 z-10">
            <svg className="w-3 h-3 text-white/50" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}

        {/* Left trim handle */}
        <div
          data-trim-handle="left"
          className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/10 hover:bg-white/30 transition-colors z-20"
          onMouseDown={handleTrimLeft}
        >
          <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded bg-white/50" />
        </div>

        {/* Right trim handle */}
        <div
          data-trim-handle="right"
          className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/10 hover:bg-white/30 transition-colors z-20"
          onMouseDown={handleTrimRight}
        >
          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded bg-white/50" />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ClipContextMenu
          clipId={clip.id}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
