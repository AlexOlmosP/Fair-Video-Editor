import type { Clip } from '@/store/types';
import { applyEasing } from './easing';

/**
 * Interpolate a keyframed property at a given global time.
 * Keyframe times are relative to clip internal time.
 * Extracted from CompositorPipeline so PreviewPlayer can use it too.
 */
export function interpolateProperty(
  clip: Clip,
  property: string,
  globalTime: number,
  defaultValue: number
): number {
  const keyframes = clip.keyframes.filter((kf) => kf.property === property);
  if (keyframes.length === 0) return defaultValue;

  const clipLocalTime = (globalTime - clip.startTime) * clip.speed;
  keyframes.sort((a, b) => a.time - b.time);

  // Before first keyframe
  if (clipLocalTime <= keyframes[0].time) return keyframes[0].value;
  // After last keyframe
  if (clipLocalTime >= keyframes[keyframes.length - 1].time) {
    return keyframes[keyframes.length - 1].value;
  }

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kfA = keyframes[i];
    const kfB = keyframes[i + 1];
    if (clipLocalTime >= kfA.time && clipLocalTime <= kfB.time) {
      const rawT = (clipLocalTime - kfA.time) / (kfB.time - kfA.time);
      const t = applyEasing(rawT, kfA.easing, kfA.bezierControls);
      return kfA.value + (kfB.value - kfA.value) * t;
    }
  }

  return defaultValue;
}
