import type { ExportPreset } from '../types';

/**
 * Build FFmpeg command arrays for common operations.
 * These are passed to ffmpeg.exec() as string arrays.
 */

export function buildExportCommand(
  inputFiles: string[],
  outputFile: string,
  preset: ExportPreset
): string[] {
  const inputs = inputFiles.flatMap((f) => ['-i', f]);
  return [
    ...inputs,
    '-c:v', preset.codec,
    '-b:v', preset.videoBitrate,
    '-r', String(preset.frameRate),
    '-s', `${preset.width}x${preset.height}`,
    '-c:a', 'aac',
    '-b:a', preset.audioBitrate,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputFile,
  ];
}

export function buildTrimCommand(
  inputFile: string,
  outputFile: string,
  startTime: number,
  duration: number
): string[] {
  return [
    '-i', inputFile,
    '-ss', String(startTime),
    '-t', String(duration),
    '-c', 'copy',
    outputFile,
  ];
}

export function buildThumbnailCommand(
  inputFile: string,
  outputFile: string,
  timestamp: number = 0
): string[] {
  return [
    '-i', inputFile,
    '-ss', String(timestamp),
    '-frames:v', '1',
    '-q:v', '2',
    '-vf', 'scale=160:-1',
    outputFile,
  ];
}

export function buildCropFilter(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number
): string {
  const sourceRatio = sourceWidth / sourceHeight;
  let cropW: number, cropH: number;

  if (targetRatio > sourceRatio) {
    // Target wider — keep width, reduce height
    cropW = sourceWidth;
    cropH = Math.round(sourceWidth / targetRatio);
  } else {
    // Target taller — keep height, reduce width
    cropH = sourceHeight;
    cropW = Math.round(sourceHeight * targetRatio);
  }

  // Ensure even dimensions for codec compatibility
  cropW = cropW - (cropW % 2);
  cropH = cropH - (cropH % 2);

  const x = Math.round((sourceWidth - cropW) / 2);
  const y = Math.round((sourceHeight - cropH) / 2);

  return `crop=${cropW}:${cropH}:${x}:${y}`;
}

export function buildConcatCommand(
  listFile: string,
  outputFile: string,
  preset: ExportPreset
): string[] {
  return [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c:v', preset.codec,
    '-b:v', preset.videoBitrate,
    '-r', String(preset.frameRate),
    '-s', `${preset.width}x${preset.height}`,
    '-c:a', 'aac',
    '-b:a', preset.audioBitrate,
    outputFile,
  ];
}
