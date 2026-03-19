'use client';

import React, { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';

interface ClipContextMenuProps {
  clipId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function ClipContextMenu({ clipId, x, y, onClose }: ClipContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleSplit = () => {
    const { playheadTime } = useTimelineStore.getState();
    useTimelineStore.getState().splitClip(clipId, playheadTime);
    onClose();
  };

  const handleDelete = () => {
    useTimelineStore.getState().removeClip(clipId);
    onClose();
  };

  const handleDuplicate = () => {
    const clip = useTimelineStore.getState().clips[clipId];
    if (!clip) return;
    const { id: _, ...clipData } = clip;
    useTimelineStore.getState().addClip({
      ...clipData,
      startTime: clip.startTime + clip.duration,
    });
    onClose();
  };

  const handleToggleLock = () => {
    const clip = useTimelineStore.getState().clips[clipId];
    if (!clip) return;
    useTimelineStore.getState().updateClip(clipId, { locked: !clip.locked });
    onClose();
  };

  const handleFreezeFrame = () => {
    useTimelineStore.getState().insertFreezeFrame(clipId, 3);
    onClose();
  };

  const handleToggleVisibility = () => {
    const clip = useTimelineStore.getState().clips[clipId];
    if (!clip) return;
    useTimelineStore.getState().updateClip(clipId, { visible: !clip.visible });
    onClose();
  };

  const clip = useTimelineStore.getState().clips[clipId];

  const menuItems = [
    { label: 'Split at Playhead', shortcut: 'Ctrl+S', action: handleSplit },
    { label: 'Freeze Frame (3s)', shortcut: '', action: handleFreezeFrame },
    { label: 'Duplicate', shortcut: '', action: handleDuplicate },
    { label: 'divider' },
    { label: clip?.locked ? 'Unlock' : 'Lock', shortcut: '', action: handleToggleLock },
    { label: clip?.visible ? 'Hide' : 'Show', shortcut: '', action: handleToggleVisibility },
    { label: 'divider' },
    { label: 'Delete', shortcut: 'Del', action: handleDelete, danger: true },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl backdrop-blur-md py-1 min-w-[180px]"
      style={{ left: x, top: y, boxShadow: 'var(--modal-shadow)' }}
    >
      {menuItems.map((item, i) =>
        item.label === 'divider' ? (
          <div key={i} className="border-t border-[var(--border-color)] my-1" />
        ) : (
          <button
            key={item.label}
            onClick={item.action}
            className={`w-full px-3 py-2 text-sm text-left flex items-center justify-between transition-colors rounded-lg mx-1 btn-press ${
              (item as { danger?: boolean }).danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
            }`}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-[var(--text-muted)] ml-4">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}
