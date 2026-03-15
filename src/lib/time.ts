/**
 * Convert seconds to timecode string (HH:MM:SS:FF)
 */
export function secondsToTimecode(seconds: number, frameRate: number = 30): string {
  const totalFrames = Math.floor(seconds * frameRate);
  const h = Math.floor(totalFrames / (frameRate * 3600));
  const m = Math.floor((totalFrames % (frameRate * 3600)) / (frameRate * 60));
  const s = Math.floor((totalFrames % (frameRate * 60)) / frameRate);
  const f = totalFrames % frameRate;
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/**
 * Convert seconds to display time (MM:SS.ms)
 */
export function secondsToDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${pad(m)}:${pad(s)}.${pad(ms)}`;
}

/**
 * Format seconds to a compact label for timeline rulers
 */
export function formatTimeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${pad(s)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
