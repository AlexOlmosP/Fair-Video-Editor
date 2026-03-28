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
import { wrapText } from '@/lib/textLayout';
import type { Clip, ColorCorrectionParams } from '@/store/types';

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
    const { playheadTime, clips, trackOrder, isPlaying, shuttleSpeed, tracks, isCropMode } = state;
    // During shuttle scrubbing, keep HTML video elements paused and just seek them
    const driveNativePlayback = isPlaying && shuttleSpeed === 0;
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
            tracks[c.trackId]?.visible !== false &&
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
          // Apply track mute
          source.muted = tracks[clip.trackId]?.muted ?? false;
          const internalTime = clip.freezeFrame
            ? clip.freezeFrame.sourceTime
            : computeInternalTime(clip, playheadTime);

          if (clip.freezeFrame) {
            if (!source.paused) source.pause();
            if (!source.seeking && Math.abs(source.currentTime - internalTime) > 0.05) {
              source.currentTime = internalTime;
            }
          } else if (driveNativePlayback) {
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

        const cc = clip.colorCorrection ?? null;
        const filterStr = buildCanvasFilter(clip.filters, cc);
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

        // Determine pixel source (bg-remove may swap to a processed canvas)
        let pixelSource: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement = source;
        if (clip.filters.includes('bg-remove') && !bgProcessingRef.current.has(clip.id)) {
          const cached = bgRemoveCache.get(clip.id);
          if (cached && Date.now() - cached.timestamp < 150) {
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = cached.imageData.width;
            tmpCanvas.height = cached.imageData.height;
            const tmpCtx = tmpCanvas.getContext('2d')!;
            tmpCtx.putImageData(cached.imageData, 0, 0);
            pixelSource = tmpCanvas;
          } else {
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
        }

        // Apply pixel-level color correction (temperature, tint, HSL) when needed
        if (cc && hasNonzeroPixelCorrection(cc)) {
          pixelSource = applyPixelColorCorrection(pixelSource, drawW, drawH, cc);
        }

        // Apply crop if set
        const crop = clip.crop;
        if (crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0)) {
          const psW = ('videoWidth' in pixelSource ? (pixelSource as HTMLVideoElement).videoWidth : (pixelSource as HTMLImageElement | HTMLCanvasElement).width) || srcW;
          const psH = ('videoHeight' in pixelSource ? (pixelSource as HTMLVideoElement).videoHeight : (pixelSource as HTMLImageElement | HTMLCanvasElement).height) || srcH;
          const cropL = (crop.left / 100) * psW;
          const cropR = (crop.right / 100) * psW;
          const cropT = (crop.top / 100) * psH;
          const cropB = (crop.bottom / 100) * psH;
          const cSrcW = psW - cropL - cropR;
          const cSrcH = psH - cropT - cropB;
          const cDrawW = drawW * (cSrcW / psW);
          const cDrawH = drawH * (cSrcH / psH);
          ctx.drawImage(pixelSource, cropL, cropT, cSrcW, cSrcH, -cDrawW / 2, -cDrawH / 2, cDrawW, cDrawH);
        } else {
          ctx.drawImage(pixelSource, -drawW / 2, -drawH / 2, drawW, drawH);
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
        tracks[c.trackId]?.visible !== false &&
        c.textData &&
        playheadTime >= c.startTime &&
        playheadTime < c.startTime + c.duration
    );
    for (const textClip of activeTextClips) {
      const td = textClip.textData!;
      if (!td.text) continue;

      try {
        const animOpacity = interpolateProperty(textClip, 'opacity', playheadTime, textClip.opacity);
        const animScaleX = interpolateProperty(textClip, 'scaleX', playheadTime, textClip.scale.x);
        const animScaleY = interpolateProperty(textClip, 'scaleY', playheadTime, textClip.scale.y);
        const animRotation = interpolateProperty(textClip, 'rotation', playheadTime, textClip.rotation);
        const animPosX = interpolateProperty(textClip, 'positionX', playheadTime, textClip.position.x);
        const animPosY = interpolateProperty(textClip, 'positionY', playheadTime, textClip.position.y);

        ctx.save();
        ctx.globalAlpha = Number.isFinite(animOpacity) ? animOpacity : 1;

        // Transform: same as media clips
        const tcx = (projectW / 2 + (Number.isFinite(animPosX) ? animPosX : 0)) * sx;
        const tcy = (projectH / 2 + (Number.isFinite(animPosY) ? animPosY : 0)) * sy;
        ctx.translate(tcx, tcy);
        ctx.rotate(((Number.isFinite(animRotation) ? animRotation : 0) * Math.PI) / 180);
        ctx.scale(
          Number.isFinite(animScaleX) ? animScaleX : 1,
          Number.isFinite(animScaleY) ? animScaleY : 1
        );

        // Set font and compute wrapped lines (measured before scale transform)
        const fontSize = Math.max(1, Math.round((td.fontSize || 48) * sy));
        const fontStr = `bold ${fontSize}px ${td.fontFamily || 'system-ui'}`;
        ctx.font = fontStr;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Wrap at 80% of canvas width (in canvas px, pre-scale)
        const maxLineWidth = cw * 0.8;
        const lines = wrapText(ctx, td.text, maxLineWidth);
        const lineH = fontSize * 1.35;
        const totalTextH = lines.length * lineH;

        // Max line width for background box
        let maxLW = 0;
        for (const line of lines) maxLW = Math.max(maxLW, ctx.measureText(line).width);
        const textW = maxLW + 24 * sx;
        const textH = totalTextH + 12 * sy;

        if (td.backgroundColor && textW > 0 && textH > 0) {
          ctx.fillStyle = td.backgroundColor;
          const rx = 8 * sx;
          ctx.beginPath();
          ctx.roundRect(-textW / 2, -textH / 2, textW, textH, rx);
          ctx.fill();
        }

        ctx.fillStyle = td.color || '#ffffff';
        for (let i = 0; i < lines.length; i++) {
          const lineY = (i - (lines.length - 1) / 2) * lineH;
          if (td.strokeColor && td.strokeWidth) {
            ctx.strokeStyle = td.strokeColor;
            ctx.lineWidth = td.strokeWidth * sx;
            ctx.strokeText(lines[i], 0, lineY);
          }
          ctx.fillText(lines[i], 0, lineY);
        }
        ctx.restore();
      } catch {
        // Skip this text clip if rendering fails
        ctx.restore();
      }
    }

    // Draw selection borders for ALL selected clips (media + text)
    const { selectedClipIds } = state;
    const allSelectableClips = [...activeClips, ...activeTextClips];
    for (const clip of allSelectableClips) {
      if (!selectedClipIds.includes(clip.id)) continue;
      if (clip.transitionData) continue;

      let drawW: number, drawH: number;

      if (clip.textData) {
        // For text clips, compute bounds using the same word-wrap logic as rendering
        const td = clip.textData;
        ctx.save();
        const selFontSize = Math.max(1, Math.round(td.fontSize * sy));
        ctx.font = `bold ${selFontSize}px ${td.fontFamily || 'system-ui'}`;
        const selLines = wrapText(ctx, td.text, cw * 0.8);
        const selLineH = selFontSize * 1.35;
        let selMaxW = 0;
        for (const line of selLines) selMaxW = Math.max(selMaxW, ctx.measureText(line).width);
        drawW = (selMaxW + 24 * sx) * clip.scale.x;
        drawH = (selLines.length * selLineH + 12 * sy) * clip.scale.y;
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

      if (isCropMode && !clip.textData) {
        // ── Crop overlay ─────────────────────────────────────────
        const crop = clip.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
        const cropL = clipCx - drawW / 2 + (crop.left / 100) * drawW;
        const cropR = clipCx + drawW / 2 - (crop.right / 100) * drawW;
        const cropT = clipCy - drawH / 2 + (crop.top / 100) * drawH;
        const cropB = clipCy + drawH / 2 - (crop.bottom / 100) * drawH;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        if (crop.top > 0)    ctx.fillRect(clipCx - drawW / 2, clipCy - drawH / 2, drawW, (crop.top / 100) * drawH);
        if (crop.bottom > 0) ctx.fillRect(clipCx - drawW / 2, cropB, drawW, (crop.bottom / 100) * drawH);
        if (crop.left > 0)   ctx.fillRect(clipCx - drawW / 2, cropT, (crop.left / 100) * drawW, cropB - cropT);
        if (crop.right > 0)  ctx.fillRect(cropR, cropT, (crop.right / 100) * drawW, cropB - cropT);

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(cropL, cropT, cropR - cropL, cropB - cropT);

        const hs = 10;
        const midX = (cropL + cropR) / 2;
        const midY = (cropT + cropB) / 2;
        for (const [hx, hy] of [
          [cropL, cropT], [midX, cropT], [cropR, cropT],
          [cropR, midY], [cropR, cropB], [midX, cropB],
          [cropL, cropB], [cropL, midY],
        ]) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
        }
        ctx.restore();
      } else {
        // ── Normal transform handles ─────────────────────────────
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

  // Render loop: 60fps when playing, 30fps when paused (still responsive to drags)
  useEffect(() => {
    let running = true;
    lastFrameTimeRef.current = performance.now();
    let lastPausedRender = 0;

    const tick = (now: number) => {
      if (!running) return;

      const store = useTimelineStore.getState();

      if (store.isPlaying) {
        // Advance playhead — full 60fps; shuttleSpeed scales direction & rate
        const delta = (now - lastFrameTimeRef.current) / 1000;
        const speed = store.shuttleSpeed !== 0 ? store.shuttleSpeed : 1;
        const newTime = store.playheadTime + delta * speed;
        const maxDuration = store.duration;

        if (speed < 0 && newTime <= 0) {
          // Backward shuttle hit beginning
          store.setPlayheadTime(0);
          store.setIsPlaying(false);
          store.setShuttleSpeed(0);
        } else if (newTime >= maxDuration && maxDuration > 0) {
          store.setPlayheadTime(maxDuration);
          store.setIsPlaying(false);
          store.setShuttleSpeed(0);
        } else {
          store.setPlayheadTime(Math.max(0, newTime));
        }
        lastFrameTimeRef.current = now;
        renderFrame();
      } else {
        // When paused, render at 30fps to stay responsive to drags/edits
        lastFrameTimeRef.current = now;
        if (now - lastPausedRender > 33) {
          lastPausedRender = now;
          renderFrame();
        }
      }
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

// ─── Color Correction Helpers ─────────────────────────────────────────────

/**
 * Build the CSS filter string for a clip.
 * Brightness/contrast/saturation from ColorCorrectionParams are hardware-
 * accelerated via CSS filter. Temperature/tint/HSL need pixel manipulation and
 * are handled in applyPixelColorCorrection.
 */
function buildCanvasFilter(filters: string[], cc?: ColorCorrectionParams | null): string {
  const parts: string[] = [];

  if (cc) {
    if (cc.brightness !== 0) parts.push(`brightness(${Math.max(0, 1 + cc.brightness / 100).toFixed(3)})`);
    if (cc.contrast   !== 0) parts.push(`contrast(${Math.max(0, 1 + cc.contrast   / 100).toFixed(3)})`);
    if (cc.saturation !== 0) parts.push(`saturate(${Math.max(0, 1 + cc.saturation / 100).toFixed(3)})`);
  }

  for (const f of filters) {
    switch (f) {
      case 'brightness': parts.push('brightness(1.3)'); break;
      case 'contrast':   parts.push('contrast(1.4)'); break;
      case 'saturate':   parts.push('saturate(1.5)'); break;
      case 'blur':       parts.push('blur(3px)'); break;
      case 'sharpen':    parts.push('contrast(1.1) brightness(1.05)'); break;
      case 'grayscale':  parts.push('grayscale(1)'); break;
      case 'sepia':      parts.push('sepia(1)'); break;
      case 'invert':     parts.push('invert(1)'); break;
      case 'hue-rotate': parts.push('hue-rotate(90deg)'); break;
    }
  }
  return parts.join(' ');
}

/** Returns true when any property requiring pixel manipulation is non-zero. */
function hasNonzeroPixelCorrection(cc: ColorCorrectionParams): boolean {
  if (cc.temperature !== 0 || cc.tint !== 0) return true;
  return Object.values(cc.hsl).some(
    (ch) => ch.hue !== 0 || ch.saturation !== 0 || ch.luminance !== 0
  );
}

// ─── Pixel-level color manipulation ───────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else                 h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5)   return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h)         * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// Hue channel centers and half-widths used for per-channel HSL masking
const HSL_CFG: Record<string, { center: number; range: number }> = {
  red:     { center: 0,   range: 30 },
  orange:  { center: 30,  range: 25 },
  yellow:  { center: 60,  range: 25 },
  green:   { center: 120, range: 45 },
  cyan:    { center: 180, range: 25 },
  blue:    { center: 240, range: 40 },
  purple:  { center: 280, range: 30 },
  magenta: { center: 330, range: 30 },
};

/**
 * Apply temperature, tint, and per-channel HSL adjustments via pixel manipulation.
 * The offscreen canvas is capped at 640 px wide for real-time performance;
 * ctx.drawImage at the call site stretches it back to drawW×drawH automatically.
 */
function applyPixelColorCorrection(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  drawW: number,
  drawH: number,
  cc: ColorCorrectionParams
): HTMLCanvasElement {
  const MAX_W = 640;
  const pxScale = drawW > MAX_W ? MAX_W / drawW : 1;
  const w = Math.max(1, Math.round(drawW * pxScale));
  const h = Math.max(1, Math.round(drawH * pxScale));

  const offscreen = document.createElement('canvas');
  offscreen.width  = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext('2d')!;
  offCtx.drawImage(source, 0, 0, w, h);

  const imageData = offCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const tempScale = cc.temperature * 2.55; // ±100 → ±255
  const tintScale = cc.tint * 2.55;
  const hasTemp = cc.temperature !== 0;
  const hasTint = cc.tint !== 0;
  const hslEntries = Object.entries(cc.hsl) as [string, { hue: number; saturation: number; luminance: number }][];
  const hasHsl = hslEntries.some(([, a]) => a.hue !== 0 || a.saturation !== 0 || a.luminance !== 0);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // Temperature: warm (+) shifts R up / B down; cool (−) the reverse
    if (hasTemp) {
      r = Math.max(0, Math.min(255, r + tempScale));
      b = Math.max(0, Math.min(255, b - tempScale));
    }

    // Tint: positive = magenta (subtract green); negative = green (add green)
    if (hasTint) {
      g = Math.max(0, Math.min(255, g - tintScale));
    }

    // Per-channel HSL adjustments
    if (hasHsl) {
      let [hh, s, l] = rgbToHsl(r, g, b);
      let dH = 0, dS = 0, dL = 0;
      for (const [name, adj] of hslEntries) {
        if (adj.hue === 0 && adj.saturation === 0 && adj.luminance === 0) continue;
        const cfg = HSL_CFG[name];
        let diff = Math.abs(hh - cfg.center);
        if (diff > 180) diff = 360 - diff;
        const wt = Math.max(0, 1 - diff / cfg.range);
        if (wt <= 0) continue;
        dH += adj.hue        * wt * 0.3;  // ±100 → ±30° hue shift
        dS += adj.saturation * wt / 100;  // ±100 → ±1 saturation shift
        dL += adj.luminance  * wt / 200;  // ±100 → ±0.5 luminance shift
      }
      hh = (hh + dH + 360) % 360;
      s  = Math.max(0, Math.min(1, s + dS));
      l  = Math.max(0, Math.min(1, l + dL));
      [r, g, b] = hslToRgb(hh, s, l);
    }

    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }

  offCtx.putImageData(imageData, 0, 0);
  return offscreen;
}
