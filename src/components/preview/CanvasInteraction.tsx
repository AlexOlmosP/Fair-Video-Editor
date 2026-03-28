'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { wrapText } from '@/lib/textLayout';

interface CanvasInteractionProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /**
   * Optional separate canvas used for Canvas 2D text measurement.
   * Provide this when canvasRef holds a WebGL canvas (which cannot return a 2D context).
   */
  measureCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

type HandleType =
  | 'tl' | 'tr' | 'bl' | 'br' | 'body'
  | 'crop-tl' | 'crop-t' | 'crop-tr' | 'crop-r'
  | 'crop-br' | 'crop-b' | 'crop-bl' | 'crop-l';

interface DragState {
  clipId: string;
  handle: HandleType;
  startMouseX: number;
  startMouseY: number;
  startPosX: number;
  startPosY: number;
  startScaleX: number;
  startScaleY: number;
  // Crop-specific state
  startCropTop?: number;
  startCropRight?: number;
  startCropBottom?: number;
  startCropLeft?: number;
  clipDrawW?: number;   // full unscaled clip width in project coords
  clipDrawH?: number;
}

export function CanvasInteraction({ canvasRef, measureCanvasRef }: CanvasInteractionProps) {
  // Resolve which canvas to use for Canvas 2D text measurement.
  // When a WebGL canvas is the primary, measureCanvasRef points to a 2D overlay canvas.
  const get2DCanvas = () => measureCanvasRef?.current ?? canvasRef.current;
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
      const { clips, trackOrder, playheadTime, selectedClipIds, tracks } = useTimelineStore.getState();
      const { elements } = useMediaStore.getState();
      const { width, height } = useProjectStore.getState().settings;

      const allClips = Object.values(clips)
        .filter(
          (c) =>
            c.visible &&
            !c.transitionData &&
            !tracks[c.trackId]?.locked &&
            tracks[c.trackId]?.visible !== false &&
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
        let drawW: number, drawH: number;

        if (clip.textData) {
          // For text clips, compute bounds using word-wrap to match the renderer
          const td = clip.textData;
          const measCanvas = get2DCanvas();
          if (measCanvas) {
            const tmpCtx = measCanvas.getContext('2d');
            if (tmpCtx) {
              tmpCtx.save();
              tmpCtx.font = `bold ${td.fontSize}px ${td.fontFamily || 'system-ui'}`;
              const maxLW = measCanvas.width * 0.8;
              const lines = wrapText(tmpCtx, td.text, maxLW);
              const lineH = td.fontSize * 1.35;
              let maxW = 0;
              for (const line of lines) maxW = Math.max(maxW, tmpCtx.measureText(line).width);
              drawW = (maxW + 24) * clip.scale.x;
              drawH = (lineH * lines.length + 12) * clip.scale.y;
              tmpCtx.restore();
            } else {
              const nLines = Math.max(1, Math.ceil(td.text.length / 20));
              drawW = (td.fontSize * Math.min(td.text.length, 20) * 0.6 + 24) * clip.scale.x;
              drawH = (td.fontSize * 1.35 * nLines + 12) * clip.scale.y;
            }
          } else {
            const nLines = Math.max(1, Math.ceil(td.text.length / 20));
            drawW = (td.fontSize * Math.min(td.text.length, 20) * 0.6 + 24) * clip.scale.x;
            drawH = (td.fontSize * 1.35 * nLines + 12) * clip.scale.y;
          }
        } else {
          const source = elements[clip.assetId];
          if (!source) continue;
          const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
          const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
          const scaleF = Math.min(width / srcW, height / srcH);
          drawW = srcW * scaleF * clip.scale.x;
          drawH = srcH * scaleF * clip.scale.y;
        }

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

  /** Hit-test the 8 crop handles for the currently-selected clip. */
  const hitTestCropHandle = useCallback(
    (clientX: number, clientY: number): { clipId: string; handle: HandleType; drawW: number; drawH: number } | null => {
      const { clips, selectedClipIds, playheadTime } = useTimelineStore.getState();
      const { elements } = useMediaStore.getState();
      const { width, height } = useProjectStore.getState().settings;

      const clipId = selectedClipIds[0];
      if (!clipId) return null;
      const clip = clips[clipId];
      if (!clip || clip.textData || clip.transitionData) return null;
      if (playheadTime < clip.startTime || playheadTime >= clip.startTime + clip.duration) return null;

      const source = elements[clip.assetId];
      if (!source) return null;

      const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
      const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
      const scaleF = Math.min(width / srcW, height / srcH);
      const drawW = srcW * scaleF * clip.scale.x;
      const drawH = srcH * scaleF * clip.scale.y;

      const { px, py } = clientToProject(clientX, clientY);
      const cx = clip.position.x;
      const cy = clip.position.y;

      const crop = clip.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const cropL = cx - drawW / 2 + (crop.left / 100) * drawW;
      const cropR = cx + drawW / 2 - (crop.right / 100) * drawW;
      const cropT = cy - drawH / 2 + (crop.top / 100) * drawH;
      const cropB = cy + drawH / 2 - (crop.bottom / 100) * drawH;
      const midX = (cropL + cropR) / 2;
      const midY = (cropT + cropB) / 2;

      const canvasEl = canvasRef.current;
      const hitR = canvasEl ? 16 * (width / canvasEl.getBoundingClientRect().width) : 16;

      const handles: [HandleType, number, number][] = [
        ['crop-tl', cropL, cropT], ['crop-t', midX, cropT], ['crop-tr', cropR, cropT],
        ['crop-r',  cropR, midY],
        ['crop-br', cropR, cropB], ['crop-b', midX, cropB], ['crop-bl', cropL, cropB],
        ['crop-l',  cropL, midY],
      ];

      for (const [handle, hx, hy] of handles) {
        if (Math.abs(px - hx) < hitR && Math.abs(py - hy) < hitR) {
          return { clipId, handle, drawW, drawH };
        }
      }
      return null;
    },
    [clientToProject, canvasRef]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const { isCropMode } = useTimelineStore.getState();

      if (isCropMode) {
        // In crop mode: try to grab a crop handle first
        const cropHit = hitTestCropHandle(e.clientX, e.clientY);
        if (cropHit) {
          const { clips } = useTimelineStore.getState();
          const clip = clips[cropHit.clipId];
          if (!clip) return;
          const crop = clip.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
          dragRef.current = {
            clipId: cropHit.clipId,
            handle: cropHit.handle,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startPosX: clip.position.x,
            startPosY: clip.position.y,
            startScaleX: clip.scale.x,
            startScaleY: clip.scale.y,
            startCropTop: crop.top,
            startCropRight: crop.right,
            startCropBottom: crop.bottom,
            startCropLeft: crop.left,
            clipDrawW: cropHit.drawW,
            clipDrawH: cropHit.drawH,
          };
          e.preventDefault();
          return;
        }
        // Otherwise just allow selection (no dragging in crop mode)
        const hit = hitTestClip(e.clientX, e.clientY);
        if (hit) {
          useTimelineStore.getState().selectClip(hit.clipId);
        } else {
          useTimelineStore.getState().deselectAll();
        }
        return;
      }

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
    [hitTestClip, hitTestCropHandle]
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

      // ── Crop handle drag ──────────────────────────────────────────
      if (drag.handle.startsWith('crop-')) {
        const dW = drag.clipDrawW ?? 1;
        const dH = drag.clipDrawH ?? 1;
        const dxPct = (deltaX / dW) * 100;
        const dyPct = (deltaY / dH) * 100;

        let top    = drag.startCropTop    ?? 0;
        let right  = drag.startCropRight  ?? 0;
        let bottom = drag.startCropBottom ?? 0;
        let left   = drag.startCropLeft   ?? 0;

        const h = drag.handle;
        if (h === 'crop-l' || h === 'crop-tl' || h === 'crop-bl') {
          left = Math.max(0, Math.min(95 - right, left + dxPct));
        }
        if (h === 'crop-r' || h === 'crop-tr' || h === 'crop-br') {
          right = Math.max(0, Math.min(95 - left, right - dxPct));
        }
        if (h === 'crop-t' || h === 'crop-tl' || h === 'crop-tr') {
          top = Math.max(0, Math.min(95 - bottom, top + dyPct));
        }
        if (h === 'crop-b' || h === 'crop-bl' || h === 'crop-br') {
          bottom = Math.max(0, Math.min(95 - top, bottom - dyPct));
        }

        updateClip(drag.clipId, { crop: { top, right, bottom, left } });
        return;
      }

      if (drag.handle === 'body') {
        // Drag position with edge snapping
        let newX = drag.startPosX + deltaX;
        let newY = drag.startPosY + deltaY;

        // Compute clip dimensions to snap edges
        const clip = useTimelineStore.getState().clips[drag.clipId];
        if (clip) {
          let halfW = 0, halfH = 0;
          if (clip.textData) {
            const td = clip.textData;
            const measCanvas2 = get2DCanvas();
            if (measCanvas2) {
              const tmpCtx = measCanvas2.getContext('2d');
              if (tmpCtx) {
                tmpCtx.save();
                tmpCtx.font = `bold ${td.fontSize}px ${td.fontFamily || 'system-ui'}`;
                const maxLW = measCanvas2.width * 0.8;
                const lines = wrapText(tmpCtx, td.text, maxLW);
                const lineH = td.fontSize * 1.35;
                let maxW = 0;
                for (const line of lines) maxW = Math.max(maxW, tmpCtx.measureText(line).width);
                halfW = (maxW + 24) * clip.scale.x / 2;
                halfH = (lineH * lines.length + 12) * clip.scale.y / 2;
                tmpCtx.restore();
              }
            }
          } else {
            const { elements } = useMediaStore.getState();
            const source = elements[clip.assetId];
            if (source) {
              const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
              const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
              const scaleF = Math.min(width / srcW, height / srcH);
              halfW = (srcW * scaleF * clip.scale.x) / 2;
              halfH = (srcH * scaleF * clip.scale.y) / 2;
            }
          }

          if (halfW > 0 && halfH > 0) {
            const halfCanvasW = width / 2;
            const halfCanvasH = height / 2;
            const snapThreshold = 15;
            if (Math.abs((newX - halfW) - (-halfCanvasW)) < snapThreshold) newX = -halfCanvasW + halfW;
            if (Math.abs((newX + halfW) - halfCanvasW) < snapThreshold) newX = halfCanvasW - halfW;
            if (Math.abs((newY - halfH) - (-halfCanvasH)) < snapThreshold) newY = -halfCanvasH + halfH;
            if (Math.abs((newY + halfH) - halfCanvasH) < snapThreshold) newY = halfCanvasH - halfH;
          }
        }

        updateClip(drag.clipId, {
          position: { x: newX, y: newY },
        });

        // Caption block editing: move all captions on the same track together
        const { tracks, clips: allClips } = useTimelineStore.getState();
        const draggedClip = allClips[drag.clipId];
        if (draggedClip && tracks[draggedClip.trackId]?.type === 'caption') {
          const siblings = Object.values(allClips).filter(
            (c) => c.trackId === draggedClip.trackId && c.id !== drag.clipId
          );
          for (const sib of siblings) {
            updateClip(sib.id, { position: { x: newX, y: newY } });
          }
        }
      } else {
        // Resize
        const clip = useTimelineStore.getState().clips[drag.clipId];
        if (!clip) return;

        let baseW: number, baseH: number;
        if (clip.textData) {
          const td = clip.textData;
          const measCanvas = get2DCanvas();
          if (measCanvas) {
            const tmpCtx = measCanvas.getContext('2d');
            if (tmpCtx) {
              tmpCtx.save();
              tmpCtx.font = `bold ${td.fontSize}px ${td.fontFamily || 'system-ui'}`;
              const maxLW = measCanvas.width * 0.8;
              const lines = wrapText(tmpCtx, td.text, maxLW);
              const lineH = td.fontSize * 1.35;
              let maxW = 0;
              for (const line of lines) maxW = Math.max(maxW, tmpCtx.measureText(line).width);
              baseW = maxW + 24;
              baseH = lineH * lines.length + 12;
              tmpCtx.restore();
            } else {
              const nLines = Math.max(1, Math.ceil(td.text.length / 20));
              baseW = td.fontSize * Math.min(td.text.length, 20) * 0.6 + 24;
              baseH = td.fontSize * 1.35 * nLines + 12;
            }
          } else {
            const nLines = Math.max(1, Math.ceil(td.text.length / 20));
            baseW = td.fontSize * Math.min(td.text.length, 20) * 0.6 + 24;
            baseH = td.fontSize * 1.35 * nLines + 12;
          }
        } else {
          const { elements } = useMediaStore.getState();
          const source = elements[clip.assetId];
          if (!source) return;
          const srcW = ('videoWidth' in source ? source.videoWidth : source.width) || width;
          const srcH = ('videoHeight' in source ? source.videoHeight : source.height) || height;
          const scaleF = Math.min(width / srcW, height / srcH);
          baseW = srcW * scaleF;
          baseH = srcH * scaleF;
        }

        let dxNorm = deltaX / baseW;
        let dyNorm = deltaY / baseH;

        if (drag.handle === 'bl' || drag.handle === 'tl') dxNorm = -dxNorm;
        if (drag.handle === 'tl' || drag.handle === 'tr') dyNorm = -dyNorm;

        const locked = useProjectStore.getState().aspectRatioLocked;

        let finalScaleX: number, finalScaleY: number;
        if (locked) {
          const scaleDelta = (dxNorm + dyNorm) / 2;
          const newScale = Math.max(0.05, Math.min(5, drag.startScaleX + scaleDelta));
          finalScaleX = newScale;
          finalScaleY = newScale;
        } else {
          finalScaleX = Math.max(0.05, Math.min(5, drag.startScaleX + dxNorm));
          finalScaleY = Math.max(0.05, Math.min(5, drag.startScaleY + dyNorm));
        }

        updateClip(drag.clipId, {
          scale: { x: finalScaleX, y: finalScaleY },
        });

        // Caption block editing: scale all captions on the same track together
        const { tracks: allTracks, clips: allClips2 } = useTimelineStore.getState();
        const scaledClip = allClips2[drag.clipId];
        if (scaledClip && allTracks[scaledClip.trackId]?.type === 'caption') {
          const siblings = Object.values(allClips2).filter(
            (c) => c.trackId === scaledClip.trackId && c.id !== drag.clipId
          );
          for (const sib of siblings) {
            updateClip(sib.id, { scale: { x: finalScaleX, y: finalScaleY } });
          }
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
      const { isCropMode } = useTimelineStore.getState();
      if (isCropMode) {
        const cropHit = hitTestCropHandle(e.clientX, e.clientY);
        setHoveredHandle(cropHit ? cropHit.handle : null);
        return;
      }
      const hit = hitTestClip(e.clientX, e.clientY);
      if (hit) {
        setHoveredHandle(hit.handle);
      } else {
        setHoveredHandle(null);
      }
    },
    [hitTestClip, hitTestCropHandle]
  );

  let cursor = 'default';
  if (dragRef.current) {
    const h = dragRef.current.handle;
    if (h === 'body') cursor = 'grabbing';
    else if (h === 'crop-tl' || h === 'crop-br') cursor = 'nwse-resize';
    else if (h === 'crop-tr' || h === 'crop-bl') cursor = 'nesw-resize';
    else if (h === 'crop-t' || h === 'crop-b') cursor = 'ns-resize';
    else if (h === 'crop-l' || h === 'crop-r') cursor = 'ew-resize';
    else cursor = 'nwse-resize';
  } else if (hoveredHandle === 'body') {
    cursor = 'grab';
  } else if (hoveredHandle === 'tl' || hoveredHandle === 'br' || hoveredHandle === 'crop-tl' || hoveredHandle === 'crop-br') {
    cursor = 'nwse-resize';
  } else if (hoveredHandle === 'tr' || hoveredHandle === 'bl' || hoveredHandle === 'crop-tr' || hoveredHandle === 'crop-bl') {
    cursor = 'nesw-resize';
  } else if (hoveredHandle === 'crop-t' || hoveredHandle === 'crop-b') {
    cursor = 'ns-resize';
  } else if (hoveredHandle === 'crop-l' || hoveredHandle === 'crop-r') {
    cursor = 'ew-resize';
  }

  // Double-click to edit text inline
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTestClip(e.clientX, e.clientY);
      if (!hit) return;
      const { clips } = useTimelineStore.getState();
      const clip = clips[hit.clipId];
      if (!clip?.textData) return;

      setEditingClipId(hit.clipId);
      setEditText(clip.textData.text);
      setTimeout(() => editInputRef.current?.focus(), 50);
    },
    [hitTestClip]
  );

  const commitEdit = useCallback(() => {
    if (editingClipId && editText.trim()) {
      const { clips, updateClip } = useTimelineStore.getState();
      const clip = clips[editingClipId];
      if (clip?.textData) {
        updateClip(editingClipId, {
          textData: { ...clip.textData, text: editText },
        });
      }
    }
    setEditingClipId(null);
  }, [editingClipId, editText]);

  // Compute position for the edit overlay
  const getEditOverlayStyle = useCallback((): React.CSSProperties => {
    if (!editingClipId) return { display: 'none' };
    const canvas = canvasRef.current;
    if (!canvas) return { display: 'none' };
    const { clips } = useTimelineStore.getState();
    const clip = clips[editingClipId];
    if (!clip?.textData) return { display: 'none' };
    const rect = canvas.getBoundingClientRect();
    const overlay = overlayRef.current;
    if (!overlay) return { display: 'none' };
    const oRect = overlay.getBoundingClientRect();
    const { width: pw, height: ph } = useProjectStore.getState().settings;

    const canvasX = ((pw / 2 + clip.position.x) / pw) * rect.width + (rect.left - oRect.left);
    const canvasY = ((ph / 2 + clip.position.y) / ph) * rect.height + (rect.top - oRect.top);

    return {
      position: 'absolute',
      left: canvasX,
      top: canvasY,
      transform: `translate(-50%, -50%) scale(${clip.scale.x}, ${clip.scale.y})`,
      fontSize: `${clip.textData.fontSize * (rect.height / ph)}px`,
      fontFamily: clip.textData.fontFamily,
      color: clip.textData.color,
      background: clip.textData.backgroundColor || 'rgba(0,0,0,0.7)',
      border: '2px solid var(--accent)',
      borderRadius: '8px',
      padding: '4px 8px',
      outline: 'none',
      textAlign: 'center' as const,
      zIndex: 100,
      minWidth: '60px',
      resize: 'none' as const,
      fontWeight: 'bold',
    };
  }, [editingClipId, canvasRef]);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMoveOverlay}
      onDoubleClick={onDoubleClick}
    >
      {editingClipId && (
        <textarea
          ref={editInputRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
            if (e.key === 'Escape') setEditingClipId(null);
          }}
          style={getEditOverlayStyle()}
          rows={1}
        />
      )}
    </div>
  );
}
