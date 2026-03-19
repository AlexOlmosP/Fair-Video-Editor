'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '@/store/useProjectStore';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useMediaStore } from '@/store/useMediaStore';
import { secondsToDisplay } from '@/lib/time';

export function AssetsPanel() {
  const assets = useProjectStore((s) => s.assets);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const importFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith('video')
        ? 'video' as const
        : file.type.startsWith('audio')
          ? 'audio' as const
          : 'image' as const;

      let mediaDuration = 5;

      if (type === 'video') {
        const info = await getVideoInfo(url);
        mediaDuration = info.duration;

        // Create persistent video element for preview rendering
        const videoEl = document.createElement('video');
        videoEl.src = url;
        videoEl.preload = 'auto';
        videoEl.muted = true;
        videoEl.playsInline = true;
        await new Promise<void>((resolve) => {
          videoEl.onloadeddata = () => resolve();
          videoEl.onerror = () => resolve();
        });

        const assetId = useProjectStore.getState().addAsset({
          name: file.name,
          type,
          src: url,
          duration: mediaDuration,
          width: info.width,
          height: info.height,
        });

        useMediaStore.getState().register(assetId, videoEl);
        generateThumbnail(videoEl, assetId, setThumbnails);
        addToTimeline(assetId, type, mediaDuration);
      } else if (type === 'audio') {
        mediaDuration = await getAudioDuration(url);
        const assetId = useProjectStore.getState().addAsset({
          name: file.name,
          type,
          src: url,
          duration: mediaDuration,
        });
        addToTimeline(assetId, type, mediaDuration);
      } else {
        // Image
        const img = new Image();
        img.src = url;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });

        const assetId = useProjectStore.getState().addAsset({
          name: file.name,
          type,
          src: url,
          duration: 5,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });

        useMediaStore.getState().register(assetId, img);
        setThumbnails((prev) => ({ ...prev, [assetId]: url }));
        addToTimeline(assetId, type, 5);
      }
    }
  }, []);

  // Listen for global file drop events from EditorLayout
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as FileList;
      if (files) importFiles(files);
    };
    window.addEventListener('editor-file-drop', handler);
    return () => window.removeEventListener('editor-file-drop', handler);
  }, [importFiles]);

  const handleFileImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/*,audio/*,image/*';
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) importFiles(files);
    };
    input.click();
  }, [importFiles]);

  const handleRemoveAsset = useCallback((assetId: string) => {
    // Remove all clips using this asset
    const { clips, removeClip } = useTimelineStore.getState();
    for (const clip of Object.values(clips)) {
      if (clip.assetId === assetId) {
        removeClip(clip.id);
      }
    }
    // Remove media element
    useMediaStore.getState().unregister(assetId);
    // Remove asset
    useProjectStore.getState().removeAsset(assetId);
    // Clean up thumbnail
    setThumbnails((prev) => {
      const { [assetId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const assetList = Object.values(assets);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Assets</h2>
        <button
          onClick={handleFileImport}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded-lg btn-press transition-colors"
        >
          + Import
        </button>
      </div>

      {/* Asset List */}
      <div className="flex-1 overflow-y-auto p-2 relative">
        {assetList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] text-sm gap-2 p-4">
            <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            <span className="text-center">Drop files here or click Import to add media</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {assetList.map((asset) => (
              <div
                key={asset.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-asset-id', asset.id);
                  e.dataTransfer.setData('application/x-asset-type', asset.type);
                  e.dataTransfer.setData('application/x-asset-duration', String(asset.duration));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                className="p-2 rounded-xl bg-[var(--bg-tertiary)] cursor-grab active:cursor-grabbing border border-[var(--border-color)] hover:border-[var(--accent)]/30 hover-glow btn-press transition-colors relative group"
              >
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveAsset(asset.id);
                  }}
                  className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-[var(--bg-secondary)]/80 hover:bg-red-600 text-[var(--text-secondary)] hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove asset"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="w-full aspect-video bg-[var(--bg-secondary)] rounded-lg mb-1.5 flex items-center justify-center overflow-hidden relative">
                  {thumbnails[asset.id] ? (
                    <img
                      src={thumbnails[asset.id]}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      {asset.type === 'video' && (
                        <svg className="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                      {asset.type === 'audio' && (
                        <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                      )}
                      {asset.type === 'image' && (
                        <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                    </>
                  )}
                  <span className="absolute bottom-0.5 right-0.5 text-[9px] bg-black/70 px-1 rounded text-[var(--text-secondary)]">
                    {secondsToDisplay(asset.duration)}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] truncate">{asset.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function addToTimeline(assetId: string, type: 'video' | 'audio' | 'image', mediaDuration: number) {
  const { trackOrder, tracks, selectedTrackId, addTrack } = useTimelineStore.getState();

  // Prefer selected track if compatible, else find first matching type
  let targetTrackId: string | undefined;

  if (selectedTrackId) {
    const sel = tracks[selectedTrackId];
    if (sel) {
      const ok =
        (type === 'audio' && sel.type === 'audio') ||
        (type !== 'audio' && (sel.type === 'video' || sel.type === 'overlay'));
      if (ok) targetTrackId = selectedTrackId;
    }
  }

  if (!targetTrackId) {
    if (type === 'image') {
      // Images: prefer overlay track, then create one
      targetTrackId = trackOrder.find((tid) => tracks[tid]?.type === 'overlay');
      if (!targetTrackId) {
        targetTrackId = addTrack('overlay', 'Overlay');
      }
    } else {
      targetTrackId = trackOrder.find((tid) => {
        const track = tracks[tid];
        if (type === 'audio') return track.type === 'audio';
        return track.type === 'video';
      });
    }
  }

  // Create track if none exists
  if (!targetTrackId) {
    targetTrackId = addTrack(type === 'audio' ? 'audio' : 'video');
  }

  // Place after last clip on target track, or at playhead if further ahead
  const allClips = useTimelineStore.getState().clips;
  const trackEnd = Object.values(allClips)
    .filter((c) => c.trackId === targetTrackId)
    .reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
  const playhead = useTimelineStore.getState().playheadTime;
  const startTime = playhead > trackEnd ? playhead : trackEnd;

  useTimelineStore.getState().addClip({
    assetId,
    trackId: targetTrackId,
    startTime,
    duration: mediaDuration,
    inPoint: 0,
    outPoint: mediaDuration,
    speed: 1,
    opacity: 1,
    volume: type === 'video' || type === 'audio' ? 1 : 0,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    filters: [],
    keyframes: [],
    blendMode: 'normal',
    locked: false,
    visible: true,
  });
}

function generateThumbnail(
  video: HTMLVideoElement,
  assetId: string,
  setThumbnails: React.Dispatch<React.SetStateAction<Record<string, string>>>
) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const seekTo = Math.min(1, video.duration * 0.1);
  video.currentTime = seekTo;
  video.onseeked = () => {
    ctx.drawImage(video, 0, 0, 160, 90);
    const thumbUrl = canvas.toDataURL('image/jpeg', 0.7);
    setThumbnails((prev) => ({ ...prev, [assetId]: thumbUrl }));
    video.currentTime = 0;
    video.onseeked = null;
  };
}

function getVideoInfo(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      resolve({ duration: el.duration || 5, width: el.videoWidth, height: el.videoHeight });
    };
    el.onerror = () => resolve({ duration: 5, width: 1920, height: 1080 });
    el.src = url;
  });
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(el.duration || 5);
    el.onerror = () => resolve(5);
    el.src = url;
  });
}
