/** Shared types for the video processing engine */

export interface ExportPreset {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: string;
  audioBitrate: string;
  codec: string;
  format: string;
}

export interface RenderFrame {
  timestamp: number;
  layers: RenderLayer[];
}

export interface RenderLayer {
  clipId: string;
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  opacity: number;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
  blendMode: string;
  filters: ProcessorEffect[];
}

export interface ProcessorEffect {
  type: string;
  params: Record<string, number | string | boolean>;
  enabled: boolean;
}

export interface ProcessorResult {
  canvas?: HTMLCanvasElement;
  imageData?: ImageData;
}
