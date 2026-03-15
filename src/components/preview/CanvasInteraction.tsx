'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';

interface CanvasInteractionProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type HandleType = 'tl' | 'tr' | 'bl' | 'br' | 'body';

interface DragState {
  clipId: string;
  handle: HandleType;
  startMouseX: number;
  startMouseY: number;
  startPosX: number;
  startPosY: number;
  startScaleX: number;
  startScaleY: number;
}

export function CanvasInteraction({ canvasRef }: CanvasInteractionProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<HandleType | null>(null);

  const getDisplayScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { sx: 1, sy: 1 };
    const rect = canvas.getBoundingClientRect();
    return {
      sx: canvas.width / rect.width,
      sy: canvas.height / rect.height,
    };
  }, [canvasRef]);

  const getCanvasOffset = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return { ox: 0, oy: 0 };
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    return {
      ox: canvasRect.left - overlayRect.left,
      oy: canvasRect.top - overlayRect.top,
    };
  }, [canvasRef]);

  const clientToProject = useCallback(
    (clientX: number, clientY: number): { px: number; py: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { px: 0, py: 0 };
      const rect = canvas.getBoundingClientRect();
      const { width, height } = useProjectStore.getState().settings;
      const sx = width / rect.width;
      const sy = height / rect.height;
      // Project coords: 0,0 = center
      const px = (clientX - rect.left) * sx - width / 2;
      const py = (clientY - rect.top) * sy - height / 2;
      return { px, py };
    },
    [canvasRef]
  );

  const hitTestClip = useCallback(
    (clientX: number, clientY: number): { clipId: string; handle: HandleType } | null => {
      const { clips, trackOrder, playheadTime, selectedClipIds } = useTimelineStore.getState();
      const { elements } = useMediaStore.getState();
      const { width, height } = useProjectStore.getState().settings;

      const allClips = Object.values(clips)
        .filter(
          (c) =>
            c.visible &&
            !c.transitionData &&
            playheadTime >= c.startTime &&
            playheadTime < c.startTime + c.duration
        )
        .sort((a, b) => {
          const aIdx = trackOrder.indexOf(a.trackId);
          const bIdx = trackOrder.indexOf(b.trackId);
          return bIdx - aIdx; // reverse order: top-most first
        });

      const { px, py } = clientToProject(clientX, clientY);

      for (const clip of allClips) {
        const source = elements[clip.assetId];
        if (!source) continue;

        const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
        const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
        const scaleF = Math.min(width / srcW, height / srcH);
        const drawW = srcW * scaleF * clip.scale.x;
        const drawH = srcH * scaleF * clip.scale.y;

        const cx = clip.position.x;
        const cy = clip.position.y;
        const halfW = drawW / 2;
        const halfH = drawH / 2;

        // Check if point is inside clip bounds (ignoring rotation for simplicity)
        const relX = px - cx;
        const relY = py - cy;

        // If this clip is selected, check resize handles first
        if (selectedClipIds.includes(clip.id)) {
          // Convert a generous screen-pixel hit area to project coords
          const canvasEl = canvasRef.current;
          const pxToProj = canvasEl
            ? width / canvasEl.getBoundingClientRect().width
            : 1;
          const hitRadius = 18 * pxToProj; // 18 screen-px grab zone per corner

          const corners: [HandleType, number, number][] = [
            ['tl', cx - halfW, cy - halfH],
            ['tr', cx + halfW, cy - halfH],
            ['bl', cx - halfW, cy + halfH],
            ['br', cx + halfW, cy + halfH],
          ];
          for (const [handle, hx, hy] of corners) {
            if (Math.abs(px - hx) < hitRadius && Math.abs(py - hy) < hitRadius) {
              return { clipId: clip.id, handle };
            }
          }

          // Also allow grabbing anywhere along the edges (within edgeZone of border)
          const edgeZone = 10 * pxToProj;
          const insideX = relX >= -halfW - edgeZone && relX <= halfW + edgeZone;
          const insideY = relY >= -halfH - edgeZone && relY <= halfH + edgeZone;
          const nearLeft = Math.abs(relX + halfW) < edgeZone;
          const nearRight = Math.abs(relX - halfW) < edgeZone;
          const nearTop = Math.abs(relY + halfH) < edgeZone;
          const nearBottom = Math.abs(relY - halfH) < edgeZone;

          if (insideY && insideX) {
            // Near a corner-ish region along the edge → pick closest corner
            if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
              const handle: HandleType =
                nearTop ? (nearLeft ? 'tl' : 'tr') : (nearLeft ? 'bl' : 'br');
              return { clipId: clip.id, handle };
            }
            // Near a single edge → pick closest corner on that edge
            if (nearLeft && insideY) {
              return { clipId: clip.id, handle: relY < 0 ? 'tl' : 'bl' };
            }
            if (nearRight && insideY) {
              return { clipId: clip.id, handle: relY < 0 ? 'tr' : 'br' };
            }
            if (nearTop && insideX) {
              return { clipId: clip.id, handle: relX < 0 ? 'tl' : 'tr' };
            }
            if (nearBottom && insideX) {
              return { clipId: clip.id, handle: relX < 0 ? 'bl' : 'br' };
            }
          }
        }

        if (relX >= -halfW && relX <= halfW && relY >= -halfH && relY <= halfH) {
          return { clipId: clip.id, handle: 'body' };
        }
      }

      return null;
    },
    [clientToProject, canvasRef]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTestClip(e.clientX, e.clientY);
      if (!hit) {
        useTimelineStore.getState().deselectAll();
        return;
      }

      const { clips, selectClip } = useTimelineStore.getState();
      selectClip(hit.clipId);
      const clip = clips[hit.clipId];
      if (!clip) return;

      dragRef.current = {
        clipId: hit.clipId,
        handle: hit.handle,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPosX: clip.position.x,
        startPosY: clip.position.y,
        startScaleX: clip.scale.x,
        startScaleY: clip.scale.y,
      };

      e.preventDefault();
    },
    [hitTestClip]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { width, height } = useProjectStore.getState().settings;
      const sx = width / rect.width;
      const sy = height / rect.height;

      const deltaX = (e.clientX - drag.startMouseX) * sx;
      const deltaY = (e.clientY - drag.startMouseY) * sy;

      const { updateClip } = useTimelineStore.getState();

      if (drag.handle === 'body') {
        // Drag position with edge snapping
        let newX = drag.startPosX + deltaX;
        let newY = drag.startPosY + deltaY;

        // Compute clip dimensions to snap edges
        const clip = useTimelineStore.getState().clips[drag.clipId];
        if (clip) {
          const { elements } = useMediaStore.getState();
          const source = elements[clip.assetId];
          if (source) {
            const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
            const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
            const scaleF = Math.min(width / srcW, height / srcH);
            const halfW = (srcW * scaleF * clip.scale.x) / 2;
            const halfH = (srcH * scaleF * clip.scale.y) / 2;
            const halfCanvasW = width / 2;
            const halfCanvasH = height / 2;
            const snapThreshold = 15; // pixels in project coords

            // Snap left edge
            if (Math.abs((newX - halfW) - (-halfCanvasW)) < snapThreshold) {
              newX = -halfCanvasW + halfW;
            }
            // Snap right edge
            if (Math.abs((newX + halfW) - halfCanvasW) < snapThreshold) {
              newX = halfCanvasW - halfW;
            }
            // Snap top edge
            if (Math.abs((newY - halfH) - (-halfCanvasH)) < snapThreshold) {
              newY = -halfCanvasH + halfH;
            }
            // Snap bottom edge
            if (Math.abs((newY + halfH) - halfCanvasH) < snapThreshold) {
              newY = halfCanvasH - halfH;
            }
          }
        }

        updateClip(drag.clipId, {
          position: { x: newX, y: newY },
        });
      } else {
        // Resize
        const clip = useTimelineStore.getState().clips[drag.clipId];
        if (!clip) return;

        const { elements } = useMediaStore.getState();
        const source = elements[clip.assetId];
        if (!source) return;

        const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
        const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
        const scaleF = Math.min(width / srcW, height / srcH);
        const baseW = srcW * scaleF;
        const baseH = srcH * scaleF;

        let dxNorm = deltaX / baseW;
        let dyNorm = deltaY / baseH;

        if (drag.handle === 'bl' || drag.handle === 'tl') dxNorm = -dxNorm;
        if (drag.handle === 'tl' || drag.handle === 'tr') dyNorm = -dyNorm;

        const locked = useProjectStore.getState().aspectRatioLocked;

        if (locked) {
          // Uniform scaling — average both axes
          const scaleDelta = (dxNorm + dyNorm) / 2;
          const newScale = Math.max(0.05, Math.min(5, drag.startScaleX + scaleDelta));
          updateClip(drag.clipId, {
            scale: { x: newScale, y: newScale },
          });
        } else {
          // Free scaling — independent X/Y
          const newScaleX = Math.max(0.05, Math.min(5, drag.startScaleX + dxNorm));
          const newScaleY = Math.max(0.05, Math.min(5, drag.startScaleY + dyNorm));
          updateClip(drag.clipId, {
            scale: { x: newScaleX, y: newScaleY },
          });
        }
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [canvasRef]);

  const onMouseMoveOverlay = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return;
      const hit = hitTestClip(e.clientX, e.clientY);
      if (hit) {
        setHoveredHandle(hit.handle);
      } else {
        setHoveredHandle(null);
      }
    },
    [hitTestClip]
  );

  let cursor = 'default';
  if (dragRef.current) {
    cursor = dragRef.current.handle === 'body' ? 'grabbing' : 'nwse-resize';
  } else if (hoveredHandle === 'body') {
    cursor = 'grab';
  } else if (hoveredHandle === 'tl' || hoveredHandle === 'br') {
    cursor = 'nwse-resize';
  } else if (hoveredHandle === 'tr' || hoveredHandle === 'bl') {
    cursor = 'nesw-resize';
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMoveOverlay}
    />
  );
}
