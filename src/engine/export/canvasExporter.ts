import type { Clip, Track } from '@/store/types';
import { interpolateProperty } from '@/engine/animation/interpolate';
import { computeInternalTime } from '@/engine/animation/speedMapping';

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

/** Seek a video element and wait for it to be ready */
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
    // Timeout fallback
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 1000);
  });
}

interface ExportOptions {
  width: number;
  height: number;
  projectWidth: number;
  projectHeight: number;
  frameRate: number;
  backgroundColor: string;
  clips: Record<string, Clip>;
  tracks: Record<string, Track>;
  trackOrder: string[];
  elements: Record<string, HTMLVideoElement | HTMLImageElement>;
  totalDuration: number;
  onProgress: (stage: string, frame: number, total: number) => void;
  writeFrame: (name: string, data: Blob) => Promise<void>;
  deleteFrame?: (name: string) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Render a single frame to the canvas at the given time.
 */
export function renderFrameToCanvasExport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  projectWidth: number,
  projectHeight: number,
  backgroundColor: string,
  time: number,
  clips: Record<string, Clip>,
  tracks: Record<string, Track>,
  trackOrder: string[],
  elements: Record<string, HTMLVideoElement | HTMLImageElement>,
) {
  renderFrameToCanvas(ctx, width, height, projectWidth, projectHeight, backgroundColor, time, clips, tracks, trackOrder, elements);
}

function renderFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  projectWidth: number,
  projectHeight: number,
  backgroundColor: string,
  time: number,
  clips: Record<string, Clip>,
  tracks: Record<string, Track>,
  trackOrder: string[],
  elements: Record<string, HTMLVideoElement | HTMLImageElement>,
) {
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Uniform scale for mapping positions from project space to export canvas
  const uScale = Math.min(width / projectWidth, height / projectHeight);

  const activeClips = Object.values(clips)
    .filter(
      (c) =>
        c.visible &&
        time >= c.startTime &&
        time < c.startTime + c.duration
    )
    .sort((a, b) => {
      const aIdx = trackOrder.indexOf(a.trackId);
      const bIdx = trackOrder.indexOf(b.trackId);
      return aIdx - bIdx;
    });

  for (const clip of activeClips) {
    if (clip.transitionData) {
      const progress = (time - clip.startTime) / clip.duration;
      const fadeColor = clip.transitionData.type === 'fade-white' ? '255,255,255' : '0,0,0';
      const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      ctx.save();
      ctx.fillStyle = `rgba(${fadeColor},${Math.min(1, alpha)})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      continue;
    }

    const source = elements[clip.assetId];
    if (!source) continue;

    const animOpacity = interpolateProperty(clip, 'opacity', time, clip.opacity);
    const animScaleX = interpolateProperty(clip, 'scaleX', time, clip.scale.x);
    const animScaleY = interpolateProperty(clip, 'scaleY', time, clip.scale.y);
    const animRotation = interpolateProperty(clip, 'rotation', time, clip.rotation);
    const animPosX = interpolateProperty(clip, 'positionX', time, clip.position.x);
    const animPosY = interpolateProperty(clip, 'positionY', time, clip.position.y);

    ctx.save();
    ctx.globalAlpha = animOpacity;

    const filterStr = buildCanvasFilter(clip.filters);
    if (filterStr) {
      ctx.filter = filterStr;
    }

    // Map position from project space to export canvas (uniform scale, centered)
    const cx = width / 2 + animPosX * uScale;
    const cy = height / 2 + animPosY * uScale;
    ctx.translate(cx, cy);
    ctx.rotate((animRotation * Math.PI) / 180);

    // Contain-scale source to export canvas, with correction to match preview proportions
    const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || projectWidth;
    const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || projectHeight;
    const exportContain = Math.min(width / srcW, height / srcH);
    const previewContain = Math.min(projectWidth / srcW, projectHeight / srcH);
    const correction = previewContain / exportContain;
    ctx.scale(animScaleX * correction, animScaleY * correction);
    const drawW = srcW * exportContain;
    const drawH = srcH * exportContain;

    ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  // Text/caption clips — same transform pipeline as media clips
  const activeTextClips = Object.values(clips).filter(
    (c) =>
      c.visible &&
      c.textData &&
      time >= c.startTime &&
      time < c.startTime + c.duration
  );
  for (const textClip of activeTextClips) {
    const td = textClip.textData!;
    if (!td.text) continue;

    try {
      const animOpacity = interpolateProperty(textClip, 'opacity', time, textClip.opacity);
      const animScaleX = interpolateProperty(textClip, 'scaleX', time, textClip.scale.x);
      const animScaleY = interpolateProperty(textClip, 'scaleY', time, textClip.scale.y);
      const animRotation = interpolateProperty(textClip, 'rotation', time, textClip.rotation);
      const animPosX = interpolateProperty(textClip, 'positionX', time, textClip.position.x);
      const animPosY = interpolateProperty(textClip, 'positionY', time, textClip.position.y);

      ctx.save();
      ctx.globalAlpha = Number.isFinite(animOpacity) ? animOpacity : 1;

      const posX = Number.isFinite(animPosX) ? animPosX : 0;
      const posY = Number.isFinite(animPosY) ? animPosY : 0;
      const tcx = width / 2 + posX * uScale;
      const tcy = height / 2 + posY * uScale;
      ctx.translate(tcx, tcy);
      ctx.rotate(((Number.isFinite(animRotation) ? animRotation : 0) * Math.PI) / 180);
      ctx.scale(
        Number.isFinite(animScaleX) ? animScaleX : 1,
        Number.isFinite(animScaleY) ? animScaleY : 1
      );

      const fontSize = Math.max(1, Math.round((td.fontSize || 48) * uScale));
      ctx.font = `bold ${fontSize}px ${td.fontFamily || 'system-ui'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(td.text);
      const textW = metrics.width + 24 * uScale;
      const textH = ((td.fontSize || 48) + 16) * uScale;

      if (td.backgroundColor && textW > 0 && textH > 0) {
        ctx.fillStyle = td.backgroundColor;
        const rx = 8 * uScale;
        ctx.beginPath();
        ctx.roundRect(-textW / 2, -textH / 2, textW, textH, rx);
        ctx.fill();
      }

      if (td.strokeColor && td.strokeWidth) {
        ctx.strokeStyle = td.strokeColor;
        ctx.lineWidth = td.strokeWidth * uScale;
        ctx.strokeText(td.text, 0, 0);
      }

      ctx.fillStyle = td.color || '#ffffff';
      ctx.fillText(td.text, 0, 0);
      ctx.restore();
    } catch {
      ctx.restore();
    }
  }
}

/**
 * Pre-compute which video assets need seeking at each frame,
 * and track last-seeked time to use small forward steps instead of random seeks.
 */
function buildSeekPlan(
  clips: Record<string, Clip>,
  elements: Record<string, HTMLVideoElement | HTMLImageElement>,
  totalFrames: number,
  frameRate: number,
): Map<string, { clipId: string; times: (number | null)[] }> {
  const videoAssets = new Map<string, { clipId: string; times: (number | null)[] }>();

  // For each asset, compute the internal time at each frame (null if inactive)
  const clipList = Object.values(clips).filter(
    (c) => c.visible && !c.transitionData && elements[c.assetId] instanceof HTMLVideoElement
  );

  for (const clip of clipList) {
    if (!videoAssets.has(clip.assetId)) {
      videoAssets.set(clip.assetId, {
        clipId: clip.id,
        times: new Array(totalFrames).fill(null),
      });
    }
    const entry = videoAssets.get(clip.assetId)!;

    for (let i = 0; i < totalFrames; i++) {
      const time = i / frameRate;
      if (time >= clip.startTime && time < clip.startTime + clip.duration) {
        const internalTime = clip.freezeFrame
          ? clip.freezeFrame.sourceTime
          : computeInternalTime(clip, time);
        entry.times[i] = internalTime;
      }
    }
  }

  return videoAssets;
}

/**
 * Renders the timeline frame-by-frame to a canvas and writes each frame
 * as a JPEG to the FFmpeg virtual filesystem.
 * Uses sequential stepping for video seeks and yields to the event loop
 * periodically to keep the UI responsive.
 */
export async function renderExportFrames(opts: ExportOptions): Promise<number> {
  const {
    width, height, projectWidth, projectHeight, frameRate, backgroundColor,
    clips, tracks, trackOrder, elements,
    totalDuration, onProgress, writeFrame, signal,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const totalFrames = Math.ceil(totalDuration * frameRate);

  // Pause all video elements
  for (const el of Object.values(elements)) {
    if (el instanceof HTMLVideoElement && !el.paused) {
      el.pause();
    }
  }

  // Pre-compute seek plan for sequential stepping
  const seekPlan = buildSeekPlan(clips, elements, totalFrames, frameRate);

  // Track last seeked time per asset to optimize small forward steps
  const lastSeekedTime = new Map<string, number>();

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

    const time = i / frameRate;
    onProgress('Rendering frames...', i, totalFrames);

    // Seek videos — use sequential stepping when possible
    const seekPromises: Promise<void>[] = [];
    const seekedAssets = new Set<string>();

    for (const [assetId, plan] of seekPlan) {
      const targetTime = plan.times[i];
      if (targetTime === null) continue;
      if (seekedAssets.has(assetId)) continue;
      seekedAssets.add(assetId);

      const video = elements[assetId] as HTMLVideoElement;
      const lastTime = lastSeekedTime.get(assetId);
      const timeDiff = lastTime !== undefined ? targetTime - lastTime : Infinity;

      // If stepping forward by a small amount (< 0.5s), use incremental seek
      // which browsers optimize better than random access
      if (timeDiff >= 0 && timeDiff < 0.5 && Math.abs(video.currentTime - targetTime) < 0.5) {
        // Small forward step — browser can usually decode from buffer
        seekPromises.push(seekVideo(video, targetTime));
      } else {
        // Random seek — necessary for large jumps or backward seeks
        seekPromises.push(seekVideo(video, targetTime));
      }
      lastSeekedTime.set(assetId, targetTime);
    }
    await Promise.all(seekPromises);

    // Render the frame
    renderFrameToCanvas(ctx, width, height, projectWidth, projectHeight, backgroundColor, time, clips, tracks, trackOrder, elements);

    // Capture frame as JPEG (0.85 quality to reduce WASM FS pressure)
    const frameBlob = await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob!),
        'image/jpeg',
        0.85
      );
    });

    const frameName = `frame_${String(i).padStart(6, '0')}.jpg`;
    await writeFrame(frameName, frameBlob);

    // Yield to event loop every 5 frames to keep UI responsive
    if (i % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return totalFrames;
}

/**
 * Export using WebCodecs VideoEncoder when available.
 * Returns encoded video data as a single Blob, or null if WebCodecs is unavailable.
 */
export async function renderExportWithWebCodecs(opts: ExportOptions): Promise<Blob | null> {
  // Feature detection
  if (typeof globalThis.VideoEncoder === 'undefined' || typeof globalThis.VideoFrame === 'undefined') {
    return null;
  }

  const {
    width, height, projectWidth, projectHeight, frameRate, backgroundColor,
    clips, tracks, trackOrder, elements,
    totalDuration, onProgress,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const totalFrames = Math.ceil(totalDuration * frameRate);
  const frameDurationMicros = Math.round(1_000_000 / frameRate);

  // Collect encoded chunks
  const encodedChunks: { data: Uint8Array; type: string; timestamp: number; duration: number }[] = [];

  return new Promise<Blob | null>(async (resolve) => {
    let encoderError = false;

    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        encodedChunks.push({
          data,
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? frameDurationMicros,
        });
      },
      error: (e) => {
        console.error('VideoEncoder error:', e);
        encoderError = true;
        resolve(null); // Fall back to JPEG path
      },
    });

    try {
      // Try H.264 first, fall back to VP8
      let codec = 'avc1.42001E'; // H.264 Baseline
      const h264Support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 10_000_000,
        framerate: frameRate,
      });

      if (!h264Support.supported) {
        codec = 'vp8';
        const vp8Support = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: 10_000_000,
          framerate: frameRate,
        });
        if (!vp8Support.supported) {
          resolve(null);
          return;
        }
      }

      encoder.configure({
        codec,
        width,
        height,
        bitrate: 10_000_000,
        framerate: frameRate,
        latencyMode: 'quality',
      });
    } catch {
      resolve(null);
      return;
    }

    // Pause all videos
    for (const el of Object.values(elements)) {
      if (el instanceof HTMLVideoElement && !el.paused) {
        el.pause();
      }
    }

    const seekPlan = buildSeekPlan(clips, elements, totalFrames, frameRate);
    const lastSeekedTime = new Map<string, number>();

    for (let i = 0; i < totalFrames; i++) {
      if (encoderError) break;

      const time = i / frameRate;
      onProgress('Encoding with WebCodecs...', i, totalFrames);

      // Seek videos
      const seekPromises: Promise<void>[] = [];
      const seekedAssets = new Set<string>();
      for (const [assetId, plan] of seekPlan) {
        const targetTime = plan.times[i];
        if (targetTime === null || seekedAssets.has(assetId)) continue;
        seekedAssets.add(assetId);
        const video = elements[assetId] as HTMLVideoElement;
        seekPromises.push(seekVideo(video, targetTime));
        lastSeekedTime.set(assetId, targetTime);
      }
      await Promise.all(seekPromises);

      // Render frame
      renderFrameToCanvas(ctx, width, height, projectWidth, projectHeight, backgroundColor, time, clips, tracks, trackOrder, elements);

      // Create VideoFrame from canvas and encode
      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurationMicros,
        duration: frameDurationMicros,
      });

      const keyFrame = i % (frameRate * 2) === 0; // Keyframe every 2 seconds
      encoder.encode(frame, { keyFrame });
      frame.close();

      // Yield every 10 frames
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (encoderError) return;

    await encoder.flush();
    encoder.close();

    if (encodedChunks.length === 0) {
      resolve(null);
      return;
    }

    // Combine chunks into a single blob
    // Note: this produces raw H.264/VP8 bitstream, not a proper MP4 container.
    // FFmpeg will be used to mux it into MP4.
    const totalSize = encodedChunks.reduce((sum, c) => sum + c.data.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of encodedChunks) {
      combined.set(chunk.data, offset);
      offset += chunk.data.byteLength;
    }

    resolve(new Blob([combined], { type: 'video/mp4' }));
  });
}

/**
 * Calculate total timeline duration from all clips.
 */
export function getTimelineDuration(clips: Record<string, Clip>): number {
  let maxEnd = 0;
  let mediaMaxEnd = 0;
  for (const clip of Object.values(clips)) {
    const end = clip.startTime + clip.duration;
    if (end > maxEnd) maxEnd = end;
    // Track media clips separately (non-text clips with actual assets)
    if (clip.assetId && !clip.textData) {
      if (end > mediaMaxEnd) mediaMaxEnd = end;
    }
  }
  // If we have media clips, use their duration (don't let captions extend the export)
  // Otherwise fall back to the overall max
  return mediaMaxEnd > 0 ? mediaMaxEnd : maxEnd;
}
