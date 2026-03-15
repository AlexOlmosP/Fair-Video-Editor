import type { ProcessorResult } from '../types';

/**
 * Chroma Key (green screen) processor.
 * Processes pixel data to remove a target color.
 */
export class ChromaKeyProcessor {
  private targetColor: [number, number, number];
  private tolerance: number;
  private smoothing: number;

  constructor(
    targetColor: [number, number, number] = [0, 255, 0],
    tolerance: number = 0.3,
    smoothing: number = 0.1
  ) {
    this.targetColor = targetColor;
    this.tolerance = tolerance;
    this.smoothing = smoothing;
  }

  setTarget(r: number, g: number, b: number): void {
    this.targetColor = [r, g, b];
  }

  setTolerance(value: number): void {
    this.tolerance = Math.max(0, Math.min(1, value));
  }

  setSmoothing(value: number): void {
    this.smoothing = Math.max(0, Math.min(1, value));
  }

  process(imageData: ImageData): ProcessorResult {
    const data = imageData.data;
    const [tR, tG, tB] = this.targetColor;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Calculate color distance (normalized 0-1)
      const distance = Math.sqrt(
        ((r - tR) / 255) ** 2 +
        ((g - tG) / 255) ** 2 +
        ((b - tB) / 255) ** 2
      ) / Math.sqrt(3);

      if (distance < this.tolerance) {
        // Fully transparent
        data[i + 3] = 0;
      } else if (distance < this.tolerance + this.smoothing) {
        // Smooth edge
        const alpha = ((distance - this.tolerance) / this.smoothing) * 255;
        data[i + 3] = Math.round(alpha);
      }
    }

    return { imageData };
  }
}
