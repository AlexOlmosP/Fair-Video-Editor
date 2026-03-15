/**
 * Background removal processor using MediaPipe Image Segmenter.
 * Follows the ChromaKey processor pattern with async initialization.
 */

import type { ProcessorResult } from '../types';

let segmenterPromise: Promise<ImageSegmenterInstance> | null = null;
let segmenterInstance: ImageSegmenterInstance | null = null;

interface ImageSegmenterInstance {
  segment(image: ImageData | HTMLVideoElement | HTMLCanvasElement): { categoryMask: { getAsFloat32Array(): Float32Array; width: number; height: number } };
  close(): void;
}

// Cache the last mask to skip frames for performance
let cachedMask: Float32Array | null = null;
let cachedMaskWidth = 0;
let cachedMaskHeight = 0;
let frameCounter = 0;
let processEveryN = 2; // Process every Nth frame

export function setQuality(quality: 'fast' | 'quality') {
  processEveryN = quality === 'fast' ? 3 : 1;
}

async function loadSegmenter(): Promise<ImageSegmenterInstance> {
  if (segmenterInstance) return segmenterInstance;
  if (segmenterPromise) return segmenterPromise;

  segmenterPromise = (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const { ImageSegmenter, FilesetResolver } = vision;

    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    segmenterInstance = segmenter as unknown as ImageSegmenterInstance;
    return segmenterInstance;
  })();

  return segmenterPromise;
}

export function isBackgroundRemovalLoading(): boolean {
  return segmenterPromise !== null && segmenterInstance === null;
}

export function isBackgroundRemovalReady(): boolean {
  return segmenterInstance !== null;
}

/**
 * Process a video frame to remove the background.
 * Uses an offscreen canvas at reduced resolution for segmentation,
 * then upscales the mask and applies it to the full-resolution frame.
 */
export async function processBackgroundRemoval(
  source: HTMLVideoElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
): Promise<ProcessorResult | null> {
  frameCounter++;

  // Skip frames for performance (reuse cached mask)
  if (frameCounter % processEveryN !== 0 && cachedMask) {
    return applyMaskToSource(source, sourceWidth, sourceHeight, cachedMask, cachedMaskWidth, cachedMaskHeight);
  }

  try {
    const segmenter = await loadSegmenter();

    // Draw source to offscreen canvas at reduced resolution for segmentation
    const segW = 256;
    const segH = 256;
    const offscreen = new OffscreenCanvas(segW, segH);
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return null;

    offCtx.drawImage(source, 0, 0, segW, segH);

    // Run segmentation
    const result = segmenter.segment(offCtx.getImageData(0, 0, segW, segH));
    if (!result.categoryMask) return null;

    const mask = result.categoryMask.getAsFloat32Array();
    cachedMask = mask;
    cachedMaskWidth = segW;
    cachedMaskHeight = segH;

    return applyMaskToSource(source, sourceWidth, sourceHeight, mask, segW, segH);
  } catch (err) {
    console.warn('Background removal failed:', err);
    return null;
  }
}

function applyMaskToSource(
  source: HTMLVideoElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number,
): ProcessorResult {
  // Draw source at full resolution
  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

  const imageData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);
  const pixels = imageData.data;

  // Apply mask to alpha channel (upscaling with nearest-neighbor)
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const maskX = Math.floor((x / sourceWidth) * maskWidth);
      const maskY = Math.floor((y / sourceHeight) * maskHeight);
      const maskIdx = maskY * maskWidth + maskX;
      const confidence = mask[maskIdx] || 0;

      const pixelIdx = (y * sourceWidth + x) * 4;
      // confidence > 0.5 = person (keep), otherwise = background (remove)
      pixels[pixelIdx + 3] = confidence > 0.5 ? 255 : 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    imageData,
    canvas: canvas as unknown as HTMLCanvasElement,
  };
}

export function destroySegmenter(): void {
  if (segmenterInstance) {
    segmenterInstance.close();
    segmenterInstance = null;
    segmenterPromise = null;
  }
  cachedMask = null;
}
