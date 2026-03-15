import { v4 as uuid } from 'uuid';
import type { Keyframe, ClipAnimation } from '@/store/types';

function kf(time: number, property: string, value: number, easing: Keyframe['easing'] = 'ease-in-out'): Keyframe {
  return { id: uuid(), time, property, value, easing };
}

/** Zoom in from 1x to targetScale */
export function zoomIn(start: number, end: number): Keyframe[] {
  return [
    kf(start, 'scaleX', 1, 'ease-in'),
    kf(start, 'scaleY', 1, 'ease-in'),
    kf(end, 'scaleX', 1.3, 'ease-out'),
    kf(end, 'scaleY', 1.3, 'ease-out'),
  ];
}

/** Zoom out from targetScale to 1x */
export function zoomOut(start: number, end: number): Keyframe[] {
  return [
    kf(start, 'scaleX', 1.3, 'ease-in'),
    kf(start, 'scaleY', 1.3, 'ease-in'),
    kf(end, 'scaleX', 1, 'ease-out'),
    kf(end, 'scaleY', 1, 'ease-out'),
  ];
}

/** Ken Burns: slow zoom + slow pan */
export function kenBurns(start: number, end: number): Keyframe[] {
  return [
    kf(start, 'scaleX', 1, 'linear'),
    kf(start, 'scaleY', 1, 'linear'),
    kf(start, 'positionX', -50, 'linear'),
    kf(start, 'positionY', -20, 'linear'),
    kf(end, 'scaleX', 1.2, 'linear'),
    kf(end, 'scaleY', 1.2, 'linear'),
    kf(end, 'positionX', 50, 'linear'),
    kf(end, 'positionY', 20, 'linear'),
  ];
}

/** Spin 360 degrees */
export function spin(start: number, end: number): Keyframe[] {
  return [
    kf(start, 'rotation', 0, 'ease-in-out'),
    kf(end, 'rotation', 360, 'ease-in-out'),
  ];
}

/** Fade in from 0 to 1 opacity */
export function fadeIn(start: number, end: number): Keyframe[] {
  return [
    kf(start, 'opacity', 0, 'ease-in'),
    kf(end, 'opacity', 1, 'ease-out'),
  ];
}

/** Fade out from 1 to 0 opacity */
export function fadeOut(start: number, end: number): Keyframe[] {
  return [
    kf(start, 'opacity', 1, 'ease-in'),
    kf(end, 'opacity', 0, 'ease-out'),
  ];
}

/** Bounce: quick scale up then back to normal */
export function bounce(start: number, end: number): Keyframe[] {
  const mid = start + (end - start) * 0.3;
  return [
    kf(start, 'scaleX', 1, 'ease-out'),
    kf(start, 'scaleY', 1, 'ease-out'),
    kf(mid, 'scaleX', 1.2, 'ease-in-out'),
    kf(mid, 'scaleY', 1.2, 'ease-in-out'),
    kf(end, 'scaleX', 1, 'ease-in'),
    kf(end, 'scaleY', 1, 'ease-in'),
  ];
}

/** Map preset IDs to their generator functions */
export const PRESET_MAP: Record<string, (start: number, end: number) => Keyframe[]> = {
  'zoom-in': zoomIn,
  'zoom-out': zoomOut,
  'ken-burns': kenBurns,
  'spin-360': spin,
  'fade-in': fadeIn,
  'fade-out': fadeOut,
  'bounce': bounce,
};

/** Animation presets for the UI */
export const ANIMATION_PRESETS = [
  { id: 'zoom-in', label: 'Zoom In' },
  { id: 'zoom-out', label: 'Zoom Out' },
  { id: 'ken-burns', label: 'Ken Burns' },
  { id: 'spin-360', label: 'Spin 360' },
  { id: 'fade-in', label: 'Fade In' },
  { id: 'fade-out', label: 'Fade Out' },
  { id: 'bounce', label: 'Bounce' },
] as const;

/**
 * Generate merged keyframes from all ClipAnimations.
 */
export function generateKeyframesFromAnimations(animations: ClipAnimation[]): Keyframe[] {
  const allKeyframes: Keyframe[] = [];
  for (const anim of animations) {
    const generator = PRESET_MAP[anim.presetId];
    if (generator) {
      allKeyframes.push(...generator(anim.startTime, anim.endTime));
    }
  }
  return allKeyframes;
}
