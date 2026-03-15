import type { Clip } from '@/store/types';
import type { RenderLayer, ProcessorEffect } from '../types';
import { computeInternalTime } from '../animation/speedMapping';
import { interpolateProperty } from '../animation/interpolate';

/**
 * Determines the compositing order and builds RenderLayers for each frame.
 * This is the central orchestrator between the timeline state and the renderer.
 */
export class CompositorPipeline {
  /**
   * Given the current time and visible clips, produce an ordered list of RenderLayers.
   * Layers are sorted by track order (lowest track = bottom layer).
   */
  buildLayers(
    clips: Clip[],
    trackOrder: string[],
    currentTime: number,
    mediaElements: Map<string, HTMLVideoElement | HTMLImageElement>
  ): RenderLayer[] {
    // Filter clips that are visible at current time
    const activeClips = clips.filter(
      (c) =>
        c.visible &&
        currentTime >= c.startTime &&
        currentTime < c.startTime + c.duration
    );

    // Sort by track order (bottom to top)
    activeClips.sort((a, b) => {
      const aIdx = trackOrder.indexOf(a.trackId);
      const bIdx = trackOrder.indexOf(b.trackId);
      return aIdx - bIdx;
    });

    const layers: RenderLayer[] = [];

    for (const clip of activeClips) {
      const source = mediaElements.get(clip.assetId);
      if (!source) continue;

      // Seek video to correct internal time (supports freeze frame + variable speed)
      if (source instanceof HTMLVideoElement) {
        const internalTime = clip.freezeFrame
          ? clip.freezeFrame.sourceTime
          : computeInternalTime(clip, currentTime);
        if (Math.abs(source.currentTime - internalTime) > 0.05) {
          source.currentTime = internalTime;
        }
      }

      const effects: ProcessorEffect[] = clip.filters.map((f) => ({
        type: f,
        params: {},
        enabled: true,
      }));

      layers.push({
        clipId: clip.id,
        source,
        opacity: interpolateProperty(clip, 'opacity', currentTime, clip.opacity),
        position: {
          x: interpolateProperty(clip, 'positionX', currentTime, clip.position.x),
          y: interpolateProperty(clip, 'positionY', currentTime, clip.position.y),
        },
        scale: {
          x: interpolateProperty(clip, 'scaleX', currentTime, clip.scale.x),
          y: interpolateProperty(clip, 'scaleY', currentTime, clip.scale.y),
        },
        rotation: interpolateProperty(clip, 'rotation', currentTime, clip.rotation),
        blendMode: clip.blendMode,
        filters: effects,
      });
    }

    return layers;
  }
}
