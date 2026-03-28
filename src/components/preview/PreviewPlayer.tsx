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
import { WebGLCompositor, type WebGLLayer } from '@/engine/renderer/WebGLCompositor';
import type { Clip, ColorCorrectionParams, TextData } from '@/store/types';

// Cache for background-removed frames (keyed by clipId)
const bgRemoveCache = new Map<string, { imageData: ImageData; timestamp: number }>();

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const bgProcessingRef = useRef<Set<string>>(new Set());
  const playingVideosRef = useRef<Set<string>>(new Set());
  const lastFrameTimeRef = useRef<number>(0);

  // WebGL compositor — null means Canvas 2D fallback
  const compositorRef = useRef<WebGLCompositor | null>(null);
  const usingWebGLRef = useRef(false);

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

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvasW = Math.min(Math.round(cw * dpr), projectW);
      const canvasH = Math.min(Math.round(ch * dpr), projectH);
      setCanvasSize({ w: canvasW, h: canvasH });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [projectW, projectH]);

  // ── Initialize WebGL compositor on canvas mount ────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (WebGLCompositor.isSupported(canvas)) {
      try {
        compositorRef.current = new WebGLCompositor(canvas);
        usingWebGLRef.current = true;
      } catch (e) {
        console.warn('[PreviewPlayer] WebGL2 init failed, falling back to Canvas 2D:', e);
        usingWebGLRef.current = false;
      }
    } else {
      usingWebGLRef.current = false;
    }

    return () => {
      compositorRef.current?.destroy();
      compositorRef.current = null;
    };
  }, []); // run once; canvas ref is stable after mount

  // ─────────────────────────────────────────────────────────────────────────
  // renderFrame: called every animation frame
  // ─────────────────────────────────────────────────────────────────────────
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const sx = cw / projectW;
    const sy = ch / projectH;

    const state = useTimelineStore.getState();
    const { playheadTime, clips, trackOrder, isPlaying, shuttleSpeed, tracks, isCropMode } = state;
    const driveNativePlayback = isPlaying && shuttleSpeed === 0;
    const { elements } = useMediaStore.getState();

    // ── Active clip cache ──────────────────────────────────────────────────
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

    // ── Text clips ─────────────────────────────────────────────────────────
    const activeTextClips = Object.values(clips).filter(
      (c) =>
        c.visible &&
        tracks[c.trackId]?.visible !== false &&
        c.textData &&
        playheadTime >= c.startTime &&
        playheadTime < c.startTime + c.duration
    );

    // Track which video assets are active this frame
    const activeVideoAssets = new Set<string>();

    // ── Video sync (shared between WebGL and Canvas 2D paths) ──────────────
    for (const clip of activeClips) {
      if (clip.transitionData) continue;
      const source = elements[clip.assetId];
      if (!(source instanceof HTMLVideoElement)) continue;

      activeVideoAssets.add(clip.assetId);
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

    // Pause videos no longer active
    for (const assetId of playingVideosRef.current) {
      if (!activeVideoAssets.has(assetId)) {
        const el = elements[assetId];
        if (el instanceof HTMLVideoElement && !el.paused) {
          el.pause();
        }
        playingVideosRef.current.delete(assetId);
      }
    }

    if (usingWebGLRef.current && compositorRef.current) {
      renderFrameWebGL(
        compositorRef.current,
        canvas,
        overlayCanvasRef.current,
        cw, ch, sx, sy,
        projectW, projectH,
        settings.backgroundColor,
        activeClips,
        activeTextClips,
        elements,
        playheadTime,
        isCropMode,
        state.selectedClipIds,
        bgProcessingRef
      );
    } else {
      renderFrameCanvas2D(
        canvas,
        overlayCanvasRef.current,
        cw, ch, sx, sy,
        projectW, projectH,
        settings.backgroundColor,
        activeClips,
        activeTextClips,
        elements,
        playheadTime,
        isCropMode,
        state.selectedClipIds,
        bgProcessingRef
      );
    }
  }, [projectW, projectH, settings.backgroundColor]);

  // ── Render loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    let running = true;
    lastFrameTimeRef.current = performance.now();
    let lastPausedRender = 0;

    const tick = (now: number) => {
      if (!running) return;

      const store = useTimelineStore.getState();

      if (store.isPlaying) {
        const delta = (now - lastFrameTimeRef.current) / 1000;
        const speed = store.shuttleSpeed !== 0 ? store.shuttleSpeed : 1;
        const newTime = store.playheadTime + delta * speed;
        const maxDuration = store.duration;

        if (speed < 0 && newTime <= 0) {
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

  // ── Pause all videos when playback stops ────────────────────────────────
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
          {/* Primary canvas: WebGL media compositing (or Canvas 2D fallback) */}
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="w-full h-full rounded-2xl border border-[var(--border-color)] bg-black"
            style={{ boxShadow: 'var(--elevated-shadow)' }}
          />
          {/* Overlay canvas: UI guides (selection borders, safe area, crop handles)
              + Canvas 2D text measurement for CanvasInteraction.
              pointer-events:none so mouse events pass through to the div overlay. */}
          <canvas
            ref={overlayCanvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="absolute inset-0 w-full h-full rounded-2xl"
            style={{ pointerEvents: 'none' }}
          />
          <CanvasInteraction canvasRef={canvasRef} measureCanvasRef={overlayCanvasRef} />
        </div>
      </div>
      <PreviewControls />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WebGL render path
// ─────────────────────────────────────────────────────────────────────────────

function renderFrameWebGL(
  compositor: WebGLCompositor,
  canvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement | null,
  cw: number, ch: number,
  sx: number, sy: number,
  projectW: number, projectH: number,
  backgroundColor: string,
  activeClips: Clip[],
  activeTextClips: Clip[],
  elements: Record<string, HTMLVideoElement | HTMLImageElement>,
  playheadTime: number,
  isCropMode: boolean,
  selectedClipIds: string[],
  bgProcessingRef: React.MutableRefObject<Set<string>>
): void {
  const layers: WebGLLayer[] = [];

  if (activeClips.length === 0) {
    // No clips: clear and draw placeholder on overlay
    compositor.clear(backgroundColor);
  } else {
    for (const clip of activeClips) {
      // Transition clips go to the overlay canvas (drawn after compositor)
      if (clip.transitionData) continue;

      const source = elements[clip.assetId];
      if (!source) continue;

      const animOpacity   = interpolateProperty(clip, 'opacity',    playheadTime, clip.opacity);
      const animScaleX    = interpolateProperty(clip, 'scaleX',     playheadTime, clip.scale.x);
      const animScaleY    = interpolateProperty(clip, 'scaleY',     playheadTime, clip.scale.y);
      const animRotation  = interpolateProperty(clip, 'rotation',   playheadTime, clip.rotation);
      const animPosX      = interpolateProperty(clip, 'positionX',  playheadTime, clip.position.x);
      const animPosY      = interpolateProperty(clip, 'positionY',  playheadTime, clip.position.y);

      // Resolve pixel source (background removal may swap to a processed canvas)
      let pixelSource: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement = source;
      if (clip.filters.includes('bg-remove') && !bgProcessingRef.current.has(clip.id)) {
        const cached = bgRemoveCache.get(clip.id);
        if (cached && Date.now() - cached.timestamp < 150) {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width  = cached.imageData.width;
          tmpCanvas.height = cached.imageData.height;
          tmpCanvas.getContext('2d')!.putImageData(cached.imageData, 0, 0);
          pixelSource = tmpCanvas;
        } else {
          const srcW = ('videoWidth'  in source ? source.videoWidth  : source.width)  || projectW;
          const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || projectH;
          bgProcessingRef.current.add(clip.id);
          processBackgroundRemoval(source, srcW, srcH).then((result) => {
            bgProcessingRef.current.delete(clip.id);
            if (result?.imageData) {
              bgRemoveCache.set(clip.id, { imageData: result.imageData, timestamp: Date.now() });
            }
          }).catch(() => { bgProcessingRef.current.delete(clip.id); });
        }
      }

      layers.push({
        cacheKey: pixelSource instanceof HTMLVideoElement ? null : clip.id,
        source: pixelSource,
        opacity: animOpacity,
        position: { x: animPosX, y: animPosY },
        scale: { x: animScaleX, y: animScaleY },
        rotation: animRotation,
        blendMode: clip.blendMode,
        filters: clip.filters,
        colorCorrection: clip.colorCorrection ?? null,
        crop: clip.crop ?? null,
      });
    }

    // Text clips: pre-render to Canvas 2D, then composite as texture
    for (const textClip of activeTextClips) {
      const td = textClip.textData!;
      if (!td.text) continue;

      try {
        const textResult = renderTextToOffscreenCanvas(td, projectW);
        if (!textResult) continue;

        const animOpacity  = interpolateProperty(textClip, 'opacity',   playheadTime, textClip.opacity);
        const animScaleX   = interpolateProperty(textClip, 'scaleX',    playheadTime, textClip.scale.x);
        const animScaleY   = interpolateProperty(textClip, 'scaleY',    playheadTime, textClip.scale.y);
        const animRotation = interpolateProperty(textClip, 'rotation',  playheadTime, textClip.rotation);
        const animPosX     = interpolateProperty(textClip, 'positionX', playheadTime, textClip.position.x);
        const animPosY     = interpolateProperty(textClip, 'positionY', playheadTime, textClip.position.y);

        layers.push({
          cacheKey: `${textClip.id}_text`,
          source: textResult.canvas,
          opacity: Number.isFinite(animOpacity) ? animOpacity : 1,
          position: {
            x: Number.isFinite(animPosX) ? animPosX : 0,
            y: Number.isFinite(animPosY) ? animPosY : 0,
          },
          scale: {
            x: Number.isFinite(animScaleX) ? animScaleX : 1,
            y: Number.isFinite(animScaleY) ? animScaleY : 1,
          },
          rotation: Number.isFinite(animRotation) ? animRotation : 0,
          blendMode: 'normal',
          filters: [],
          colorCorrection: null,
          crop: null,
          nativeSize: true,
        });
      } catch {
        // Skip text clip on render error
      }
    }

    compositor.renderFrame(projectW, projectH, backgroundColor, layers);
  }

  // ── Overlay canvas: transitions + UI guides ──────────────────────────────
  if (!overlayCanvas) return;
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx) return;

  overlayCtx.clearRect(0, 0, cw, ch);

  // "Import media" placeholder (when no clips)
  if (activeClips.length === 0) {
    overlayCtx.fillStyle = '#3f3f46';
    overlayCtx.font = `${Math.round(16 * sx)}px system-ui`;
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';
    overlayCtx.fillText('Import media to get started', cw / 2, ch / 2);
  }

  // Transition overlays (drawn above all media layers)
  for (const clip of activeClips) {
    if (!clip.transitionData) continue;
    const progress = (playheadTime - clip.startTime) / clip.duration;
    const fadeColor = clip.transitionData.type === 'fade-white' ? '255,255,255' : '0,0,0';
    const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    overlayCtx.save();
    overlayCtx.fillStyle = `rgba(${fadeColor},${Math.min(1, alpha)})`;
    overlayCtx.fillRect(0, 0, cw, ch);
    overlayCtx.restore();
  }

  drawUIOverlays(
    overlayCtx, cw, ch, sx, sy,
    projectW, projectH,
    activeClips, activeTextClips,
    elements, playheadTime, isCropMode, selectedClipIds
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas 2D fallback render path (same logic as original, UI overlays extracted)
// ─────────────────────────────────────────────────────────────────────────────

function renderFrameCanvas2D(
  canvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement | null,
  cw: number, ch: number,
  sx: number, sy: number,
  projectW: number, projectH: number,
  backgroundColor: string,
  activeClips: Clip[],
  activeTextClips: Clip[],
  elements: Record<string, HTMLVideoElement | HTMLImageElement>,
  playheadTime: number,
  isCropMode: boolean,
  selectedClipIds: string[],
  bgProcessingRef: React.MutableRefObject<Set<string>>
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, cw, ch);

  if (activeClips.length === 0) {
    ctx.fillStyle = '#3f3f46';
    ctx.font = `${Math.round(16 * sx)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Import media to get started', cw / 2, ch / 2);
  } else {
    for (const clip of activeClips) {
      if (clip.transitionData) {
        const progress = (playheadTime - clip.startTime) / clip.duration;
        const fadeColor = clip.transitionData.type === 'fade-white' ? '255,255,255' : '0,0,0';
        const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
        ctx.save();
        ctx.fillStyle = `rgba(${fadeColor},${Math.min(1, alpha)})`;
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
        continue;
      }

      const source = elements[clip.assetId];
      if (!source) continue;

      const animOpacity  = interpolateProperty(clip, 'opacity',    playheadTime, clip.opacity);
      const animScaleX   = interpolateProperty(clip, 'scaleX',     playheadTime, clip.scale.x);
      const animScaleY   = interpolateProperty(clip, 'scaleY',     playheadTime, clip.scale.y);
      const animRotation = interpolateProperty(clip, 'rotation',   playheadTime, clip.rotation);
      const animPosX     = interpolateProperty(clip, 'positionX',  playheadTime, clip.position.x);
      const animPosY     = interpolateProperty(clip, 'positionY',  playheadTime, clip.position.y);

      ctx.save();
      ctx.globalAlpha = animOpacity;
      ctx.globalCompositeOperation = mapBlendMode2D(clip.blendMode);

      const cc = clip.colorCorrection ?? null;
      const filterStr = buildCanvasFilter(clip.filters, cc);
      if (filterStr) ctx.filter = filterStr;

      const cx = (projectW / 2 + animPosX) * sx;
      const cy = (projectH / 2 + animPosY) * sy;
      ctx.translate(cx, cy);
      ctx.rotate((animRotation * Math.PI) / 180);
      ctx.scale(animScaleX, animScaleY);

      const srcW = ('videoWidth'  in source ? source.videoWidth  : source.width)  || projectW;
      const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || projectH;
      const scaleF = Math.min(projectW / srcW, projectH / srcH);
      const drawW  = srcW * scaleF * sx;
      const drawH  = srcH * scaleF * sy;

      // Resolve pixel source (bg-remove)
      let pixelSource: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement = source;
      if (clip.filters.includes('bg-remove') && !bgProcessingRef.current.has(clip.id)) {
        const cached = bgRemoveCache.get(clip.id);
        if (cached && Date.now() - cached.timestamp < 150) {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width  = cached.imageData.width;
          tmpCanvas.height = cached.imageData.height;
          tmpCanvas.getContext('2d')!.putImageData(cached.imageData, 0, 0);
          pixelSource = tmpCanvas;
        } else {
          bgProcessingRef.current.add(clip.id);
          processBackgroundRemoval(source, srcW, srcH).then((result) => {
            bgProcessingRef.current.delete(clip.id);
            if (result?.imageData) {
              bgRemoveCache.set(clip.id, { imageData: result.imageData, timestamp: Date.now() });
            }
          }).catch(() => { bgProcessingRef.current.delete(clip.id); });
        }
      }

      // Apply pixel-level color correction (temperature, tint, HSL) when needed
      if (cc && hasNonzeroPixelCorrection(cc)) {
        pixelSource = applyPixelColorCorrection(pixelSource, drawW, drawH, cc);
      }

      // Apply crop if set
      const crop = clip.crop;
      if (crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0)) {
        const psW = ('videoWidth'  in pixelSource ? (pixelSource as HTMLVideoElement).videoWidth  : (pixelSource as HTMLImageElement | HTMLCanvasElement).width)  || srcW;
        const psH = ('videoHeight' in pixelSource ? (pixelSource as HTMLVideoElement).videoHeight : (pixelSource as HTMLImageElement | HTMLCanvasElement).height) || srcH;
        const cropL = (crop.left   / 100) * psW;
        const cropR = (crop.right  / 100) * psW;
        const cropT = (crop.top    / 100) * psH;
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

  // Text clips (Canvas 2D path)
  for (const textClip of activeTextClips) {
    const td = textClip.textData!;
    if (!td.text) continue;

    try {
      const animOpacity  = interpolateProperty(textClip, 'opacity',   playheadTime, textClip.opacity);
      const animScaleX   = interpolateProperty(textClip, 'scaleX',    playheadTime, textClip.scale.x);
      const animScaleY   = interpolateProperty(textClip, 'scaleY',    playheadTime, textClip.scale.y);
      const animRotation = interpolateProperty(textClip, 'rotation',  playheadTime, textClip.rotation);
      const animPosX     = interpolateProperty(textClip, 'positionX', playheadTime, textClip.position.x);
      const animPosY     = interpolateProperty(textClip, 'positionY', playheadTime, textClip.position.y);

      ctx.save();
      ctx.globalAlpha = Number.isFinite(animOpacity) ? animOpacity : 1;

      const tcx = (projectW / 2 + (Number.isFinite(animPosX) ? animPosX : 0)) * sx;
      const tcy = (projectH / 2 + (Number.isFinite(animPosY) ? animPosY : 0)) * sy;
      ctx.translate(tcx, tcy);
      ctx.rotate(((Number.isFinite(animRotation) ? animRotation : 0) * Math.PI) / 180);
      ctx.scale(
        Number.isFinite(animScaleX) ? animScaleX : 1,
        Number.isFinite(animScaleY) ? animScaleY : 1
      );

      const fontSize = Math.max(1, Math.round((td.fontSize || 48) * sy));
      const fontStr = `bold ${fontSize}px ${td.fontFamily || 'system-ui'}`;
      ctx.font = fontStr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxLineWidth = cw * 0.8;
      const lines = wrapText(ctx, td.text, maxLineWidth);
      const lineH = fontSize * 1.35;
      const totalTextH = lines.length * lineH;

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
      ctx.restore();
    }
  }

  // UI overlays on overlay canvas
  if (overlayCanvas) {
    const overlayCtx = overlayCanvas.getContext('2d');
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, cw, ch);
      drawUIOverlays(
        overlayCtx, cw, ch, sx, sy,
        projectW, projectH,
        activeClips, activeTextClips,
        elements, playheadTime, isCropMode, selectedClipIds
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI overlay drawing (selection borders, crop, safe area, center guides)
// ─────────────────────────────────────────────────────────────────────────────

function drawUIOverlays(
  ctx: CanvasRenderingContext2D,
  cw: number, ch: number,
  sx: number, sy: number,
  projectW: number, projectH: number,
  activeClips: Clip[],
  activeTextClips: Clip[],
  elements: Record<string, HTMLVideoElement | HTMLImageElement>,
  playheadTime: number,
  isCropMode: boolean,
  selectedClipIds: string[]
): void {
  const allSelectableClips = [...activeClips, ...activeTextClips];

  for (const clip of allSelectableClips) {
    if (!selectedClipIds.includes(clip.id)) continue;
    if (clip.transitionData) continue;

    let drawW: number, drawH: number;

    if (clip.textData) {
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
      const srcW = ('videoWidth'  in source ? source.videoWidth  : source.width)  || projectW;
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
      const crop = clip.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const cropL = clipCx - drawW / 2 + (crop.left   / 100) * drawW;
      const cropR = clipCx + drawW / 2 - (crop.right  / 100) * drawW;
      const cropT = clipCy - drawH / 2 + (crop.top    / 100) * drawH;
      const cropB = clipCy + drawH / 2 - (crop.bottom / 100) * drawH;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      if (crop.top    > 0) ctx.fillRect(clipCx - drawW/2, clipCy - drawH/2, drawW, (crop.top    / 100) * drawH);
      if (crop.bottom > 0) ctx.fillRect(clipCx - drawW/2, cropB,             drawW, (crop.bottom / 100) * drawH);
      if (crop.left   > 0) ctx.fillRect(clipCx - drawW/2, cropT, (crop.left  / 100) * drawW, cropB - cropT);
      if (crop.right  > 0) ctx.fillRect(cropR,             cropT, (crop.right / 100) * drawW, cropB - cropT);

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(cropL, cropT, cropR - cropL, cropB - cropT);

      const hs = 10;
      const midX = (cropL + cropR) / 2;
      const midY = (cropT + cropB) / 2;
      for (const [hx, hy] of [
        [cropL, cropT], [midX, cropT], [cropR, cropT],
        [cropR, midY],  [cropR, cropB],[midX, cropB],
        [cropL, cropB], [cropL, midY],
      ]) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hx - hs/2, hy - hs/2, hs, hs);
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(clipCx - drawW/2, clipCy - drawH/2, drawW, drawH);

      const hs = 12;
      const corners = [
        [clipCx - drawW/2, clipCy - drawH/2],
        [clipCx + drawW/2, clipCy - drawH/2],
        [clipCx - drawW/2, clipCy + drawH/2],
        [clipCx + drawW/2, clipCy + drawH/2],
      ];
      for (const [hx, hy] of corners) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx - hs/2, hy - hs/2, hs, hs);
      }
      ctx.restore();
    }
  }

  // Safe area overlay
  const currentSafeArea = useProjectStore.getState().safeAreaRatio;
  if (currentSafeArea) {
    const preset = ASPECT_RATIO_PRESETS.find((p) => p.label === currentSafeArea);
    if (preset) {
      drawSafeAreaOverlay(ctx, cw, ch, preset.ratio, preset.label);
    }
  }

  // Center crosshair guides when a clip is selected
  if (selectedClipIds.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(cw/2, 0); ctx.lineTo(cw/2, ch); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, ch/2); ctx.lineTo(cw, ch/2); ctx.stroke();
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text pre-render helper for WebGL path
// ─────────────────────────────────────────────────────────────────────────────

function renderTextToOffscreenCanvas(
  td: TextData,
  projectW: number
): { canvas: HTMLCanvasElement } | null {
  if (!td.text) return null;

  const fontSize = Math.max(1, td.fontSize || 48);
  const fontStr  = `bold ${fontSize}px ${td.fontFamily || 'system-ui'}`;

  // Measure using a scratch canvas
  const scratch = document.createElement('canvas');
  scratch.width  = 1;
  scratch.height = 1;
  const measCtx = scratch.getContext('2d')!;
  measCtx.font = fontStr;
  const maxLW = projectW * 0.8;
  const lines = wrapText(measCtx, td.text, maxLW);
  const lineH = fontSize * 1.35;

  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, measCtx.measureText(line).width);
  const textW = Math.max(1, Math.ceil(maxW + 24));
  const textH = Math.max(1, Math.ceil(lines.length * lineH + 12));

  const offscreen = document.createElement('canvas');
  offscreen.width  = textW;
  offscreen.height = textH;
  const ctx = offscreen.getContext('2d')!;

  ctx.font = fontStr;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  if (td.backgroundColor) {
    ctx.fillStyle = td.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, textW, textH, 8);
    ctx.fill();
  }

  ctx.fillStyle = td.color || '#ffffff';
  for (let i = 0; i < lines.length; i++) {
    const lineY = textH / 2 + (i - (lines.length - 1) / 2) * lineH;
    if (td.strokeColor && td.strokeWidth) {
      ctx.strokeStyle = td.strokeColor;
      ctx.lineWidth   = td.strokeWidth;
      ctx.strokeText(lines[i], textW / 2, lineY);
    }
    ctx.fillText(lines[i], textW / 2, lineY);
  }

  return { canvas: offscreen };
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe area overlay
// ─────────────────────────────────────────────────────────────────────────────

function drawSafeAreaOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number, canvasH: number,
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

// ─────────────────────────────────────────────────────────────────────────────
// Canvas 2D helpers (used only in fallback path)
// ─────────────────────────────────────────────────────────────────────────────

function mapBlendMode2D(mode: string): GlobalCompositeOperation {
  const map: Record<string, GlobalCompositeOperation> = {
    normal:   'source-over',
    multiply: 'multiply',
    screen:   'screen',
    overlay:  'overlay',
    darken:   'darken',
    lighten:  'lighten',
  };
  return map[mode] ?? 'source-over';
}

/**
 * Build the CSS filter string for a clip (Canvas 2D fallback path).
 * Brightness/contrast/saturation from ColorCorrectionParams are hardware-
 * accelerated via CSS filter. Temperature/tint/HSL need pixel manipulation.
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
      case 'brightness': parts.push('brightness(1.3)');           break;
      case 'contrast':   parts.push('contrast(1.4)');             break;
      case 'saturate':   parts.push('saturate(1.5)');             break;
      case 'blur':       parts.push('blur(3px)');                 break;
      case 'sharpen':    parts.push('contrast(1.1) brightness(1.05)'); break;
      case 'grayscale':  parts.push('grayscale(1)');              break;
      case 'sepia':      parts.push('sepia(1)');                  break;
      case 'invert':     parts.push('invert(1)');                 break;
      case 'hue-rotate': parts.push('hue-rotate(90deg)');         break;
    }
  }
  return parts.join(' ');
}

function hasNonzeroPixelCorrection(cc: ColorCorrectionParams): boolean {
  if (cc.temperature !== 0 || cc.tint !== 0) return true;
  return Object.values(cc.hsl).some(
    (ch) => ch.hue !== 0 || ch.saturation !== 0 || ch.luminance !== 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixel-level color manipulation (Canvas 2D fallback path only — moved to GPU
// in WebGL path via shader uniforms)
// ─────────────────────────────────────────────────────────────────────────────

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
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h)       * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

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

  const tempScale = cc.temperature * 2.55;
  const tintScale = cc.tint * 2.55;
  const hasTemp = cc.temperature !== 0;
  const hasTint = cc.tint !== 0;
  const hslEntries = Object.entries(cc.hsl) as [string, { hue: number; saturation: number; luminance: number }][];
  const hasHsl = hslEntries.some(([, a]) => a.hue !== 0 || a.saturation !== 0 || a.luminance !== 0);

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i+1], b = data[i+2];

    if (hasTemp) {
      r = Math.max(0, Math.min(255, r + tempScale));
      b = Math.max(0, Math.min(255, b - tempScale));
    }
    if (hasTint) {
      g = Math.max(0, Math.min(255, g - tintScale));
    }

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
        dH += adj.hue        * wt * 0.3;
        dS += adj.saturation * wt / 100;
        dL += adj.luminance  * wt / 200;
      }
      hh = (hh + dH + 360) % 360;
      s  = Math.max(0, Math.min(1, s + dS));
      l  = Math.max(0, Math.min(1, l + dL));
      [r, g, b] = hslToRgb(hh, s, l);
    }

    data[i] = r; data[i+1] = g; data[i+2] = b;
  }

  offCtx.putImageData(imageData, 0, 0);
  return offscreen;
}

