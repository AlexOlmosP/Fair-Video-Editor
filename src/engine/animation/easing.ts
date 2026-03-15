import type { Keyframe } from '@/store/types';

/** Standard ease-in (quadratic) */
export function easeIn(t: number): number {
  return t * t;
}

/** Standard ease-out (quadratic) */
export function easeOut(t: number): number {
  return t * (2 - t);
}

/** Standard ease-in-out (quadratic) */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Cubic bezier curve evaluation using De Casteljau's algorithm */
export function cubicBezier(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  // We need to find the t parameter for the given x, then return y
  // Approximate with binary search for x → t mapping
  let low = 0;
  let high = 1;
  let mid: number;

  for (let i = 0; i < 20; i++) {
    mid = (low + high) / 2;
    const x = sampleCurveX(mid, x1, x2);
    if (x < t) {
      low = mid;
    } else {
      high = mid;
    }
  }

  mid = (low + high) / 2;
  return sampleCurveY(mid, y1, y2);
}

function sampleCurveX(t: number, x1: number, x2: number): number {
  return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
}

function sampleCurveY(t: number, y1: number, y2: number): number {
  return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
}

/** Apply the appropriate easing function based on the keyframe's easing type */
export function applyEasing(
  t: number,
  easing: Keyframe['easing'],
  bezierControls?: [number, number, number, number]
): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'ease-in':
      return easeIn(t);
    case 'ease-out':
      return easeOut(t);
    case 'ease-in-out':
      return easeInOut(t);
    case 'bezier':
      if (bezierControls) {
        return cubicBezier(t, ...bezierControls);
      }
      return t;
    default:
      return t;
  }
}
