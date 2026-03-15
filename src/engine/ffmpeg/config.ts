import type { ExportPreset } from '../types';

/** FFmpeg.wasm export presets optimized for quality tiers */
export const EXPORT_PRESETS: Record<string, ExportPreset> = {
  '720p': {
    name: '720p HD',
    width: 1280,
    height: 720,
    frameRate: 30,
    videoBitrate: '5000k',
    audioBitrate: '192k',
    codec: 'libx264',
    format: 'mp4',
  },
  '1080p': {
    name: '1080p Full HD',
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitrate: '10000k',
    audioBitrate: '256k',
    codec: 'libx264',
    format: 'mp4',
  },
  '1080p60': {
    name: '1080p 60fps',
    width: 1920,
    height: 1080,
    frameRate: 60,
    videoBitrate: '15000k',
    audioBitrate: '256k',
    codec: 'libx264',
    format: 'mp4',
  },
  '4k': {
    name: '4K Ultra HD',
    width: 3840,
    height: 2160,
    frameRate: 30,
    videoBitrate: '35000k',
    audioBitrate: '320k',
    codec: 'libx264',
    format: 'mp4',
  },
  '4k60': {
    name: '4K 60fps',
    width: 3840,
    height: 2160,
    frameRate: 60,
    videoBitrate: '55000k',
    audioBitrate: '320k',
    codec: 'libx264',
    format: 'mp4',
  },
};

/** Default threading config for FFmpeg.wasm */
export const FFMPEG_CONFIG = {
  corePath: '/ffmpeg/ffmpeg-core.js',
  wasmPath: '/ffmpeg/ffmpeg-core.wasm',
  workerPath: '/ffmpeg/ffmpeg-core.worker.js',
  log: process.env.NODE_ENV === 'development',
};
