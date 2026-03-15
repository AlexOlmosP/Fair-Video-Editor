'use client';

import { useState, useCallback, useRef } from 'react';

interface DragState {
  isDragging: boolean;
  clipId: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  offsetX: number;
  offsetY: number;
}

const INITIAL_STATE: DragState = {
  isDragging: false,
  clipId: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  offsetX: 0,
  offsetY: 0,
};

interface UseDragDropOptions {
  onDragStart?: (clipId: string, e: React.MouseEvent) => void;
  onDragMove?: (clipId: string, deltaX: number, deltaY: number) => void;
  onDragEnd?: (clipId: string, deltaX: number, deltaY: number) => void;
}

export function useDragDrop(options: UseDragDropOptions = {}) {
  const [dragState, setDragState] = useState<DragState>(INITIAL_STATE);
  const stateRef = useRef(dragState);
  stateRef.current = dragState;

  const handleMouseDown = useCallback(
    (clipId: string, e: React.MouseEvent) => {
      e.preventDefault();
      const state: DragState = {
        isDragging: true,
        clipId,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        offsetX: 0,
        offsetY: 0,
      };
      setDragState(state);
      options.onDragStart?.(clipId, e);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - state.startX;
        const deltaY = moveEvent.clientY - state.startY;
        setDragState((s) => ({
          ...s,
          currentX: moveEvent.clientX,
          currentY: moveEvent.clientY,
          offsetX: deltaX,
          offsetY: deltaY,
        }));
        options.onDragMove?.(clipId, deltaX, deltaY);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        const deltaX = upEvent.clientX - state.startX;
        const deltaY = upEvent.clientY - state.startY;
        options.onDragEnd?.(clipId, deltaX, deltaY);
        setDragState(INITIAL_STATE);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [options]
  );

  return {
    dragState,
    handleMouseDown,
  };
}
