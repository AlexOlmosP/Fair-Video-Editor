import type { RenderLayer } from '../types';

/**
 * Real-time preview renderer using Canvas 2D.
 * Composites all visible layers at the current playhead time.
 * WebGL upgrade path: swap this for a WebGL compositor when needed.
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private animationFrameId: number | null = null;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    this.canvas.width = width;
    this.canvas.height = height;
    this.width = width;
    this.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Render a single frame from a set of layers (bottom to top).
   */
  renderFrame(layers: RenderLayer[], backgroundColor: string = '#000000'): void {
    this.ctx.fillStyle = backgroundColor;
    this.ctx.fillRect(0, 0, this.width, this.height);

    for (const layer of layers) {
      this.ctx.save();
      this.ctx.globalAlpha = layer.opacity;
      this.ctx.globalCompositeOperation = this.mapBlendMode(layer.blendMode);

      // Transform: translate → rotate → scale
      const cx = this.width / 2 + layer.position.x;
      const cy = this.height / 2 + layer.position.y;
      this.ctx.translate(cx, cy);
      this.ctx.rotate((layer.rotation * Math.PI) / 180);
      this.ctx.scale(layer.scale.x, layer.scale.y);

      const srcWidth = layer.source.width || this.width;
      const srcHeight = layer.source.height || this.height;
      this.ctx.drawImage(layer.source, -srcWidth / 2, -srcHeight / 2, srcWidth, srcHeight);

      this.ctx.restore();
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  private mapBlendMode(mode: string): GlobalCompositeOperation {
    const map: Record<string, GlobalCompositeOperation> = {
      normal: 'source-over',
      multiply: 'multiply',
      screen: 'screen',
      overlay: 'overlay',
      darken: 'darken',
      lighten: 'lighten',
    };
    return map[mode] ?? 'source-over';
  }
}
