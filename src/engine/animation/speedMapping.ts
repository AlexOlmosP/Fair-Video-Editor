import type { Clip } from '@/store/types';

/**
 * Compute the internal (source media) time for a clip at a given global timeline time.
 * When speed keyframes exist, numerically integrates the speed curve.
 * Otherwise falls back to the simple constant-speed formula.
 */
export function computeInternalTime(clip: Clip, globalTime: number): number {
  const speedKeyframes = clip.keyframes
    .filter((kf) => kf.property === 'speed')
    .sort((a, b) => a.time - b.time);

  if (speedKeyframes.length === 0) {
    // Constant speed
    return clip.inPoint + (globalTime - clip.startTime) * clip.speed;
  }

  // Variable speed: integrate speed over time from clip start to globalTime
  const elapsed = globalTime - clip.startTime;
  if (elapsed <= 0) return clip.inPoint;

  // Convert elapsed timeline time to clip-local time
  // Speed keyframes are in clip-local time
  let accumulated = 0;
  let prevTime = 0;
  let prevSpeed = speedKeyframes[0].value;

  for (const kf of speedKeyframes) {
    if (kf.time >= elapsed) {
      // Interpolate to the exact elapsed time
      const segDuration = elapsed - prevTime;
      const t = kf.time > prevTime ? (elapsed - prevTime) / (kf.time - prevTime) : 0;
      const endSpeed = prevSpeed + (kf.value - prevSpeed) * t;
      accumulated += segDuration * (prevSpeed + endSpeed) / 2;
      return clip.inPoint + accumulated;
    }

    // Full segment
    const segDuration = kf.time - prevTime;
    accumulated += segDuration * (prevSpeed + kf.value) / 2;
    prevTime = kf.time;
    prevSpeed = kf.value;
  }

  // After last keyframe: constant speed at last keyframe value
  const remaining = elapsed - prevTime;
  accumulated += remaining * prevSpeed;

  return clip.inPoint + accumulated;
}
