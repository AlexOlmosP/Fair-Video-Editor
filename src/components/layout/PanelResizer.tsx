'use client';

import React from 'react';

interface PanelResizerProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
}

export function PanelResizer({ direction, onResize }: PanelResizerProps) {
  const isHorizontal = direction === 'horizontal';

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = isHorizontal ? e.clientX : e.clientY;

    const onMove = (me: MouseEvent) => {
      const currentPos = isHorizontal ? me.clientX : me.clientY;
      onResize(currentPos - startPos);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className={`
        ${isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
        bg-transparent hover:bg-[var(--accent)]/50 transition-all duration-200 flex-shrink-0
      `}
      onMouseDown={handleMouseDown}
    />
  );
}
