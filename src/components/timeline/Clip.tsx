'use client';

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useTimelineStore, suppressHistory, restoreHistorySuppression } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { ClipContextMenu } from './ClipContextMenu';
import type { Clip as ClipType } from '@/store/types';
import { MIN_CLIP_DURATION, SNAP_THRESHOLD_PX } from '@/lib/constants';

/** Collect all clip edge times and marker times across all tracks (except the given clip) */
function getSnapEdges(excludeClipId: string): number[] {
  const { clips, markers } = useTimelineStore.getState();
  const edges: number[] = [0]; // always snap to timeline start
  for (const c of Object.values(clips)) {
    if (c.id === excludeClipId) continue;
    edges.push(c.startTime, c.startTime + c.duration);
  }
  // Markers are valid snap targets
  for (const m of markers) {
    edges.push(m.time);
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
  const moveGroupClips = useTimelineStore((s) => s.moveGroupClips);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const tracks = useTimelineStore((s) => s.tracks);
  const groups = useTimelineStore((s) => s.groups);
  const assets = useProjectStore((s) => s.assets);

  const groupColor = clip.groupId ? groups[clip.groupId]?.color : undefined;

  const isTrackLocked = tracks[clip.trackId]?.locked ?? false;
  const isEffectivelyLocked = clip.locked || isTrackLocked;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  const isSelected = selectedClipIds.includes(clip.id);
  const asset = assets[clip.assetId];
  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;
  // Subscribe to waveform data so component re-renders when peaks arrive
  const waveform = useMediaStore((s) => s.waveforms[clip.assetId]);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);

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

  // Draw real waveform on canvas whenever peaks, clip bounds, or width change
  useEffect(() => {
    if (!waveform || !asset || asset.type !== 'audio') return;
    const canvas = waveCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Map clip's source window (inPoint→outPoint) into waveform sample range
    const assetDuration = asset.duration || 1;
    const startFrac = clip.inPoint / assetDuration;
    const endFrac = Math.min(clip.outPoint, assetDuration) / assetDuration;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';

    for (let px = 0; px < w; px++) {
      const frac = startFrac + (px / w) * (endFrac - startFrac);
      const idx = Math.floor(frac * waveform.length);
      const amplitude = waveform[Math.min(idx, waveform.length - 1)];
      const barH = Math.max(1, amplitude * h);
      ctx.fillRect(px, (h - barH) / 2, 1, barH);
    }
  }, [waveform, asset, clip.inPoint, clip.outPoint, Math.floor(width)]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const multiSelect = e.shiftKey || e.ctrlKey || e.metaKey;
    if (isEffectivelyLocked) { selectClip(clip.id, multiSelect); return; }
    const target = e.target as HTMLElement;
    if (target.dataset.trimHandle) return;

    selectClip(clip.id, multiSelect);

    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = clip.startTime;
    const origTrackId = clip.trackId;
    const edges = getSnapEdges(clip.id);
    const snapThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond;
    let rafId = 0;
    let pendingMove: { trackId: string; startTime: number } | null = null;

    // Cache track element rects once at drag start
    const trackRects: { id: string; top: number; bottom: number }[] = [];
    document.querySelectorAll('[data-track-id]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      trackRects.push({ id: el.getAttribute('data-track-id') || '', top: rect.top, bottom: rect.bottom });
    });

    suppressHistory();
    const before = useTimelineStore.getState()._snapshotTimeline();

    const onMove = (me: MouseEvent) => {
      const deltaX = me.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newStartTime = Math.max(0, startTime + deltaTime);
      const clipEnd = newStartTime + clip.duration;

      const snappedStart = snapTime(newStartTime, edges, snapThreshold);
      if (snappedStart !== newStartTime) {
        newStartTime = snappedStart;
      } else {
        const snappedEnd = snapTime(clipEnd, edges, snapThreshold);
        if (snappedEnd !== clipEnd) {
          newStartTime = snappedEnd - clip.duration;
        }
      }

      if (clip.groupId) {
        pendingMove = { trackId: origTrackId, startTime: Math.max(0, newStartTime) };
      } else {
        let targetTrackId = origTrackId;
        if (Math.abs(me.clientY - startY) > 15) {
          for (const tr of trackRects) {
            if (me.clientY >= tr.top && me.clientY <= tr.bottom) {
              targetTrackId = tr.id;
              break;
            }
          }
        }
        pendingMove = { trackId: targetTrackId, startTime: Math.max(0, newStartTime) };
      }

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (pendingMove) {
            if (clip.groupId) {
              moveGroupClips(clip.groupId, clip.id, pendingMove.startTime);
            } else {
              moveClip(clip.id, pendingMove.trackId, pendingMove.startTime);
            }
          }
          rafId = 0;
        });
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rafId) cancelAnimationFrame(rafId);
      if (pendingMove) {
        if (clip.groupId) {
          moveGroupClips(clip.groupId, clip.id, pendingMove.startTime);
        } else {
          moveClip(clip.id, pendingMove.trackId, pendingMove.startTime);
        }
      }
      restoreHistorySuppression();
      const after = useTimelineStore.getState()._snapshotTimeline();
      useTimelineStore.getState()._pushHistory?.('moveClip', before, after);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clip.id, clip.startTime, clip.trackId, clip.groupId, clip.duration, selectClip, moveClip, moveGroupClips, pixelsPerSecond]);

  const handleTrimLeft = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isEffectivelyLocked) return;
    selectClip(clip.id);

    const startX = e.clientX;
    const origStartTime = clip.startTime;
    const origDuration = clip.duration;
    const origInPoint = clip.inPoint;
    const edges = getSnapEdges(clip.id);
    const snapThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond;
    let rafId = 0;
    let pendingUpdate: Record<string, number> | null = null;

    suppressHistory();
    const before = useTimelineStore.getState()._snapshotTimeline();

    const onMove = (me: MouseEvent) => {
      const deltaX = me.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newStartTime = Math.max(0, origStartTime + deltaTime);
      newStartTime = snapTime(newStartTime, edges, snapThreshold);

      const trimAmount = newStartTime - origStartTime;
      const newDuration = origDuration - trimAmount;
      const newInPoint = origInPoint + trimAmount * clip.speed;

      if (newDuration >= MIN_CLIP_DURATION && newInPoint >= 0) {
        pendingUpdate = { startTime: newStartTime, duration: newDuration, inPoint: newInPoint };
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            if (pendingUpdate) updateClip(clip.id, pendingUpdate);
            rafId = 0;
          });
        }
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rafId) cancelAnimationFrame(rafId);
      if (pendingUpdate) updateClip(clip.id, pendingUpdate);
      restoreHistorySuppression();
      // Push single history entry for entire trim operation
      const after = useTimelineStore.getState()._snapshotTimeline();
      useTimelineStore.getState()._pushHistory?.('trimLeft', before, after);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clip, selectClip, updateClip, pixelsPerSecond]);

  const handleTrimRight = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isEffectivelyLocked) return;
    selectClip(clip.id);

    const startX = e.clientX;
    const origDuration = clip.duration;
    const origOutPoint = clip.outPoint;
    const origStartTime = clip.startTime;
    const edges = getSnapEdges(clip.id);
    const snapThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond;

    const el = useMediaStore.getState().elements[clip.assetId];
    const sourceDuration = (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) ? el.duration : Infinity;
    let rafId = 0;
    let pendingUpdate: Record<string, number> | null = null;

    suppressHistory();
    const before = useTimelineStore.getState()._snapshotTimeline();

    const onMove = (me: MouseEvent) => {
      const deltaX = me.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      let newEndTime = origStartTime + origDuration + deltaTime;
      newEndTime = snapTime(newEndTime, edges, snapThreshold);

      const newDuration = Math.max(MIN_CLIP_DURATION, newEndTime - origStartTime);
      const durationDelta = newDuration - origDuration;
      const newOutPoint = origOutPoint + durationDelta * clip.speed;

      if (newOutPoint > sourceDuration || newOutPoint < 0) return;

      pendingUpdate = { duration: newDuration, outPoint: newOutPoint };
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (pendingUpdate) updateClip(clip.id, pendingUpdate);
          rafId = 0;
        });
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rafId) cancelAnimationFrame(rafId);
      if (pendingUpdate) updateClip(clip.id, pendingUpdate);
      restoreHistorySuppression();
      const after = useTimelineStore.getState()._snapshotTimeline();
      useTimelineStore.getState()._pushHistory?.('trimRight', before, after);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clip, selectClip, updateClip, pixelsPerSecond]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isEffectivelyLocked) return;
    // Preserve multi-selection so Group option works; only select if not already selected
    if (!selectedClipIds.includes(clip.id)) {
      selectClip(clip.id);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [clip.id, selectClip, isEffectivelyLocked, selectedClipIds]);

  const isAudio = asset?.type === 'audio';
  const isTransition = !!clip.transitionData;

  return (
    <>
      <div
        className={`absolute top-1 bottom-1 rounded-lg select-none overflow-hidden transition-shadow ${
          isEffectivelyLocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
        } ${
          isSelected ? 'ring-2 ring-[var(--accent)]/70 shadow-lg' : 'hover:brightness-110'
        }`}
        style={{
          left,
          width: Math.max(width, 4),
          backgroundColor: isTransition ? '#1e1e2e' : trackColor,
          opacity: isEffectivelyLocked ? 0.5 : clip.visible ? 1 : 0.3,
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

        {/* Audio waveform — real peaks when decoded, sine placeholder while loading */}
        {isAudio && (
          <div className="absolute inset-0 overflow-hidden">
            {waveform ? (
              <canvas
                ref={waveCanvasRef}
                className="w-full h-full"
                width={Math.max(1, Math.floor(width))}
                height={48}
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              /* Sine-wave placeholder while audio is being decoded */
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

        {/* Group color stripe */}
        {groupColor && (
          <div
            className="absolute top-0 left-0 right-0 h-[3px] z-20 rounded-t-lg"
            style={{ backgroundColor: groupColor }}
          />
        )}

        {/* Lock indicator */}
        {clip.locked && (
          <div className="absolute top-0.5 right-0.5 z-10">
            <svg className="w-3 h-3 text-white/50" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}

        {/* Left trim handle — 10px grab zone for easier trimming */}
        <div
          data-trim-handle="left"
          className="absolute left-0 top-0 bottom-0 w-[10px] cursor-ew-resize hover:bg-white/25 transition-colors z-20 group/trim"
          onMouseDown={handleTrimLeft}
        >
          <div className="absolute left-[3px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-white/40 group-hover/trim:bg-white/80 transition-colors" />
        </div>

        {/* Right trim handle — 10px grab zone for easier trimming */}
        <div
          data-trim-handle="right"
          className="absolute right-0 top-0 bottom-0 w-[10px] cursor-ew-resize hover:bg-white/25 transition-colors z-20 group/trim"
          onMouseDown={handleTrimRight}
        >
          <div className="absolute right-[3px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-white/40 group-hover/trim:bg-white/80 transition-colors" />
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
