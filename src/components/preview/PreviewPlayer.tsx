'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { PreviewControls } from './PreviewControls';
import { CanvasInteraction } from './CanvasInteraction';
import { useProjectStore } from '@/store/useProjectStore';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useMediaStore } from '@/store/useMediaStore';
import { ASPECT_RATIO_PRESETS } from '@/lib/constants';
import { computeInternalTime } from '@/engine/animation/speedMapping';
import { processBackgroundRemoval } from '@/engine/processors/BackgroundRemover';
import { interpolateProperty } from '@/engine/animation/interpolate';
import type { Clip } from '@/store/types';

// Cache for background-removed frames (keyed by clipId)
const bgRemoveCache = new Map<string, { imageData: ImageData; timestamp: number }>();

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const bgProcessingRef = useRef<Set<string>>(new Set());
  const playingVideosRef = useRef<Set<string>>(new Set());
  const lastFrameTimeRef = useRef<number>(0);

  // Cache refs to avoid per-frame allocations
  const cachedClipsObjRef = useRef<Record<string, Clip> | null>(null);
  const cachedActiveRef = useRef<{ timeBucket: number; clips: Clip[] } | null>(null);

  const settings = useProjectStore((s) => s.settings);
  const { width: projectW, height: projectH } = settings;

  // Dynamic canvas sizing based on container
  const [canvasSize, setCanvasSize] = useState({ w: projectW, h: projectH });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: cw, height: ch } = entry.contentRect;
      if (cw === 0 || ch === 0) return;

      // Scale canvas to display size x DPR (capped at 2x), never exceed project resolution
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvasW = Math.min(Math.round(cw * dpr), projectW);
      const canvasH = Math.min(Math.round(ch * dpr), projectH);
      setCanvasSize({ w: canvasW, h: canvasH });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [projectW, projectH]);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    // Scale factor from project coords to canvas coords
    const sx = cw / projectW;
    const sy = ch / projectH;

    const state = useTimelineStore.getState();
    const { playheadTime, clips, trackOrder, isPlaying } = state;
    const { elements } = useMediaStore.getState();
    const { safeAreaRatio } = useProjectStore.getState();

    // Clear
    ctx.fillStyle = settings.backgroundColor;
    ctx.fillRect(0, 0, cw, ch);

    // Get active clips — cache when clips object + time bucket haven't changed
    let activeClips: Clip[];
    const clipsChanged = clips !== cachedClipsObjRef.current;
    const timeBucket = Math.floor(playheadTime * 60);

    if (!clipsChanged && cachedActiveRef.current && timeBucket === cachedActiveRef.current.timeBucket) {
      activeClips = cachedActiveRef.current.clips;
    } else {
      cachedClipsObjRef.current = clips;
      activeClips = Object.values(clips)
        .filter(
          (c) =>
            c.visible &&
            playheadTime >= c.startTime &&
            playheadTime < c.startTime + c.duration
        )
        .sort((a, b) => {
          const aIdx = trackOrder.indexOf(a.trackId);
          const bIdx = trackOrder.indexOf(b.trackId);
          return aIdx - bIdx;
        });
      cachedActiveRef.current = { timeBucket, clips: activeClips };
    }

    // Track which video assets are active this frame
    const activeVideoAssets = new Set<string>();

    if (activeClips.length === 0) {
      ctx.fillStyle = '#3f3f46';
      ctx.font = `${Math.round(16 * sx)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Import media to get started', cw / 2, ch / 2);
    } else {
      for (const clip of activeClips) {
        // Render transition clips as fade overlay
        if (clip.transitionData) {
          const progress = (playheadTime - clip.startTime) / clip.duration;
          const fadeColor = clip.transitionData.type === 'fade-white' ? '255,255,255' : '0,0,0';
          const alpha = progress < 0.5
            ? progress * 2
            : (1 - progress) * 2;
          ctx.save();
          ctx.fillStyle = `rgba(${fadeColor},${Math.min(1, alpha)})`;
          ctx.fillRect(0, 0, cw, ch);
          ctx.restore();
          continue;
        }

        const source = elements[clip.assetId];
        if (!source) continue;

        // --- Video sync ---
        if (source instanceof HTMLVideoElement) {
          activeVideoAssets.add(clip.assetId);
          const internalTime = clip.freezeFrame
            ? clip.freezeFrame.sourceTime
            : computeInternalTime(clip, playheadTime);

          if (clip.freezeFrame) {
            if (!source.paused) source.pause();
            if (!source.seeking && Math.abs(source.currentTime - internalTime) > 0.05) {
              source.currentTime = internalTime;
            }
          } else if (isPlaying) {
            const clampedSpeed = Math.max(0.0625, Math.min(16, clip.speed));
            if (source.paused) {
              source.currentTime = internalTime;
              source.playbackRate = clampedSpeed;
              source.play().catch(() => {});
              playingVideosRef.current.add(clip.assetId);
            } else {
              if (Math.abs(source.playbackRate - clampedSpeed) > 0.01) {
                source.playbackRate = clampedSpeed;
              }
              if (!source.seeking && Math.abs(source.currentTime - internalTime) > 0.3) {
                source.currentTime = internalTime;
              }
            }
          } else {
            if (!source.paused) {
              source.pause();
              playingVideosRef.current.delete(clip.assetId);
            }
            if (!source.seeking && Math.abs(source.currentTime - internalTime) > 0.02) {
              source.currentTime = internalTime;
            }
          }
        }

        // --- Interpolate keyframed properties ---
        const animOpacity = interpolateProperty(clip, 'opacity', playheadTime, clip.opacity);
        const animScaleX = interpolateProperty(clip, 'scaleX', playheadTime, clip.scale.x);
        const animScaleY = interpolateProperty(clip, 'scaleY', playheadTime, clip.scale.y);
        const animRotation = interpolateProperty(clip, 'rotation', playheadTime, clip.rotation);
        const animPosX = interpolateProperty(clip, 'positionX', playheadTime, clip.position.x);
        const animPosY = interpolateProperty(clip, 'positionY', playheadTime, clip.position.y);

        ctx.save();
        ctx.globalAlpha = animOpacity;

        const filterStr = buildCanvasFilter(clip.filters);
        if (filterStr) {
          ctx.filter = filterStr;
        }

        // Transform (scaled to canvas coordinates)
        const cx = (projectW / 2 + animPosX) * sx;
        const cy = (projectH / 2 + animPosY) * sy;
        ctx.translate(cx, cy);
        ctx.rotate((animRotation * Math.PI) / 180);
        ctx.scale(animScaleX, animScaleY);

        // Draw source scaled to fit within the canvas (contain)
        const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || projectW;
        const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || projectH;
        const scaleX = projectW / srcW;
        const scaleY = projectH / srcH;
        const scale = Math.min(scaleX, scaleY);
        const drawW = srcW * scale * sx;
        const drawH = srcH * scale * sy;

        // Handle background removal
        if (clip.filters.includes('bg-remove') && !bgProcessingRef.current.has(clip.id)) {
          const cached = bgRemoveCache.get(clip.id);
          if (cached && Date.now() - cached.timestamp < 150) {
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = cached.imageData.width;
            tmpCanvas.height = cached.imageData.height;
            const tmpCtx = tmpCanvas.getContext('2d')!;
            tmpCtx.putImageData(cached.imageData, 0, 0);
            ctx.drawImage(tmpCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
          } else {
            ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
            bgProcessingRef.current.add(clip.id);
            processBackgroundRemoval(source, srcW, srcH).then((result) => {
              bgProcessingRef.current.delete(clip.id);
              if (result?.imageData) {
                bgRemoveCache.set(clip.id, {
                  imageData: result.imageData,
                  timestamp: Date.now(),
                });
              }
            }).catch(() => {
              bgProcessingRef.current.delete(clip.id);
            });
          }
        } else {
          ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
        }
        ctx.restore();
      }
    }

    // Pause videos that are no longer active
    for (const assetId of playingVideosRef.current) {
      if (!activeVideoAssets.has(assetId)) {
        const el = elements[assetId];
        if (el instanceof HTMLVideoElement && !el.paused) {
          el.pause();
        }
        playingVideosRef.current.delete(assetId);
      }
    }

    // Draw text/caption clips using the same transform pipeline as media clips
    const activeTextClips = Object.values(clips).filter(
      (c) =>
        c.visible &&
        c.textData &&
        playheadTime >= c.startTime &&
        playheadTime < c.startTime + c.duration
    );
    for (const textClip of activeTextClips) {
      const td = textClip.textData!;
      const animOpacity = interpolateProperty(textClip, 'opacity', playheadTime, textClip.opacity);
      const animScaleX = interpolateProperty(textClip, 'scaleX', playheadTime, textClip.scale.x);
      const animScaleY = interpolateProperty(textClip, 'scaleY', playheadTime, textClip.scale.y);
      const animRotation = interpolateProperty(textClip, 'rotation', playheadTime, textClip.rotation);
      const animPosX = interpolateProperty(textClip, 'positionX', playheadTime, textClip.position.x);
      const animPosY = interpolateProperty(textClip, 'positionY', playheadTime, textClip.position.y);

      ctx.save();
      ctx.globalAlpha = animOpacity;

      // Transform: same as media clips
      const tcx = (projectW / 2 + animPosX) * sx;
      const tcy = (projectH / 2 + animPosY) * sy;
      ctx.translate(tcx, tcy);
      ctx.rotate((animRotation * Math.PI) / 180);
      ctx.scale(animScaleX, animScaleY);

      // Measure text at base size
      ctx.font = `bold ${Math.round(td.fontSize * sy)}px ${td.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(td.text);
      const textW = metrics.width + 24 * sx;
      const textH = (td.fontSize + 16) * sy;

      if (td.backgroundColor) {
        ctx.fillStyle = td.backgroundColor;
        const rx = 8 * sx;
        ctx.beginPath();
        ctx.roundRect(-textW / 2, -textH / 2, textW, textH, rx);
        ctx.fill();
      }

      if (td.strokeColor && td.strokeWidth) {
        ctx.strokeStyle = td.strokeColor;
        ctx.lineWidth = td.strokeWidth * sx;
        ctx.strokeText(td.text, 0, 0);
      }

      ctx.fillStyle = td.color;
      ctx.fillText(td.text, 0, 0);
      ctx.restore();
    }

    // Draw selection borders for ALL selected clips (media + text)
    const { selectedClipIds } = state;
    const allSelectableClips = [...activeClips, ...activeTextClips];
    for (const clip of allSelectableClips) {
      if (!selectedClipIds.includes(clip.id)) continue;
      if (clip.transitionData) continue;

      let drawW: number, drawH: number;

      if (clip.textData) {
        // For text clips, compute bounds from text metrics
        const td = clip.textData;
        ctx.save();
        ctx.font = `bold ${Math.round(td.fontSize * sy)}px ${td.fontFamily}`;
        const metrics = ctx.measureText(td.text);
        drawW = (metrics.width / sy + 24) * clip.scale.x * sx;
        drawH = (td.fontSize + 16) * clip.scale.y * sy;
        ctx.restore();
      } else {
        const source = elements[clip.assetId];
        if (!source) continue;
        const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || projectW;
        const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || projectH;
        const scaleF = Math.min(projectW / srcW, projectH / srcH);
        drawW = srcW * scaleF * clip.scale.x * sx;
        drawH = srcH * scaleF * clip.scale.y * sy;
      }

      const animPX = interpolateProperty(clip, 'positionX', playheadTime, clip.position.x);
      const animPY = interpolateProperty(clip, 'positionY', playheadTime, clip.position.y);
      const clipCx = (projectW / 2 + animPX) * sx;
      const clipCy = (projectH / 2 + animPY) * sy;

      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(clipCx - drawW / 2, clipCy - drawH / 2, drawW, drawH);

      const hs = 12;
      const corners = [
        [clipCx - drawW / 2, clipCy - drawH / 2],
        [clipCx + drawW / 2, clipCy - drawH / 2],
        [clipCx - drawW / 2, clipCy + drawH / 2],
        [clipCx + drawW / 2, clipCy + drawH / 2],
      ];
      for (const [hx, hy] of corners) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      ctx.restore();
    }

    // Draw safe area overlay
    const currentSafeArea = useProjectStore.getState().safeAreaRatio;
    if (currentSafeArea) {
      const preset = ASPECT_RATIO_PRESETS.find((p) => p.label === currentSafeArea);
      if (preset) {
        drawSafeAreaOverlay(ctx, cw, ch, preset.ratio, preset.label);
      }
    }

    // Draw center crosshair guides when a clip is selected
    if (selectedClipIds.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      // Vertical center line
      ctx.beginPath();
      ctx.moveTo(cw / 2, 0);
      ctx.lineTo(cw / 2, ch);
      ctx.stroke();
      // Horizontal center line
      ctx.beginPath();
      ctx.moveTo(0, ch / 2);
      ctx.lineTo(cw, ch / 2);
      ctx.stroke();
      ctx.restore();
    }
  }, [projectW, projectH, settings.backgroundColor]);

  // Single RAF loop: advances playhead + renders in one tick
  useEffect(() => {
    let running = true;
    lastFrameTimeRef.current = performance.now();

    const tick = (now: number) => {
      if (!running) return;

      // Advance playhead if playing
      const store = useTimelineStore.getState();
      if (store.isPlaying) {
        const delta = (now - lastFrameTimeRef.current) / 1000;
        const newTime = store.playheadTime + delta;
        const maxDuration = store.duration;

        if (newTime >= maxDuration && maxDuration > 0) {
          store.setPlayheadTime(maxDuration);
          store.setIsPlaying(false);
        } else {
          store.setPlayheadTime(newTime);
        }
      }
      lastFrameTimeRef.current = now;

      renderFrame();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      const els = useMediaStore.getState().elements;
      for (const assetId of playingVideosRef.current) {
        const el = els[assetId];
        if (el instanceof HTMLVideoElement && !el.paused) {
          el.pause();
        }
      }
      playingVideosRef.current.clear();
    };
  }, [renderFrame]);

  // Pause all videos when playback stops
  useEffect(() => {
    const unsub = useTimelineStore.subscribe((state, prev) => {
      if (prev.isPlaying && !state.isPlaying) {
        const els = useMediaStore.getState().elements;
        for (const assetId of playingVideosRef.current) {
          const el = els[assetId];
          if (el instanceof HTMLVideoElement && !el.paused) {
            el.pause();
          }
        }
        playingVideosRef.current.clear();
      }
    });
    return unsub;
  }, []);

  const aspectRatio = projectW / projectH;

  return (
    <div className="flex flex-col items-center gap-3 p-4 w-full h-full">
      <div className="flex-1 flex items-center justify-center w-full min-h-0 relative">
        <div
          ref={containerRef}
          className="relative max-w-full max-h-full"
          style={{ aspectRatio: `${aspectRatio}` }}
        >
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="w-full h-full rounded-2xl border border-[var(--border-color)] bg-black"
            style={{ boxShadow: 'var(--elevated-shadow)' }}
          />
          <CanvasInteraction canvasRef={canvasRef} />
        </div>
      </div>
      <PreviewControls />
    </div>
  );
}

/** Draw safe area overlay with darkened outside regions and dashed guide lines */
function drawSafeAreaOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  targetRatio: number,
  label: string
) {
  const canvasRatio = canvasW / canvasH;

  let safeW: number, safeH: number;
  if (targetRatio > canvasRatio) {
    safeW = canvasW;
    safeH = canvasW / targetRatio;
  } else {
    safeH = canvasH;
    safeW = canvasH * targetRatio;
  }

  const safeX = (canvasW - safeW) / 2;
  const safeY = (canvasH - safeH) / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  if (safeY > 0) ctx.fillRect(0, 0, canvasW, safeY);
  if (safeY > 0) ctx.fillRect(0, safeY + safeH, canvasW, canvasH - safeY - safeH);
  if (safeX > 0) ctx.fillRect(0, safeY, safeX, safeH);
  if (safeX > 0) ctx.fillRect(safeX + safeW, safeY, canvasW - safeX - safeW, safeH);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(safeX, safeY, safeW, safeH);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, safeX + 8, safeY + 8);
  ctx.restore();
}

/** Map effect IDs to Canvas 2D filter strings */
function buildCanvasFilter(filters: string[]): string {
  if (filters.length === 0) return '';

  const parts: string[] = [];
  for (const f of filters) {
    switch (f) {
      case 'brightness': parts.push('brightness(1.3)'); break;
      case 'contrast': parts.push('contrast(1.4)'); break;
      case 'saturate': parts.push('saturate(1.5)'); break;
      case 'blur': parts.push('blur(3px)'); break;
      case 'sharpen': parts.push('contrast(1.1) brightness(1.05)'); break;
      case 'grayscale': parts.push('grayscale(1)'); break;
      case 'sepia': parts.push('sepia(1)'); break;
      case 'invert': parts.push('invert(1)'); break;
      case 'hue-rotate': parts.push('hue-rotate(90deg)'); break;
      case 'chroma-green': parts.push('hue-rotate(0deg)'); break;
      case 'chroma-blue': parts.push('hue-rotate(0deg)'); break;
    }
  }
  return parts.join(' ');
}
