'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '@/store/useProjectStore';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useMediaStore } from '@/store/useMediaStore';
import { secondsToDisplay } from '@/lib/time';
import { decodeAndExtractPeaks, evictAudioBuffer } from '@/lib/audioWaveform';
import { MediaAsset } from '@/store/types';

type ViewMode = 'grid' | 'list';
type SortKey = 'name' | 'type' | 'date' | 'size';

function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_ORDER: Record<MediaAsset['type'], number> = { video: 0, audio: 1, image: 2 };

const TYPE_COLORS: Record<MediaAsset['type'], string> = {
  video: 'text-blue-400',
  audio: 'text-green-400',
  image: 'text-purple-400',
};

const TYPE_LABELS: Record<MediaAsset['type'], string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
};

function TypeIcon({ type, className = 'w-5 h-5' }: { type: MediaAsset['type']; className?: string }) {
  if (type === 'video') {
    return (
      <svg className={`${className} text-blue-400`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }
  if (type === 'audio') {
    return (
      <svg className={`${className} text-green-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    );
  }
  return (
    <svg className={`${className} text-purple-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

export function AssetsPanel() {
  const assets = useProjectStore((s) => s.assets);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [searchQuery, setSearchQuery] = useState('');

  const importFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith('video')
        ? 'video' as const
        : file.type.startsWith('audio')
          ? 'audio' as const
          : 'image' as const;

      const size = file.size;
      const dateAdded = Date.now();
      let mediaDuration = 5;

      if (type === 'video') {
        const info = await getVideoInfo(url);
        mediaDuration = info.duration;

        const videoEl = document.createElement('video');
        videoEl.src = url;
        videoEl.preload = 'auto';
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.loop = false;
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
          size,
          dateAdded,
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
          size,
          dateAdded,
        });
        // Register audio element so captions and playback can access it
        const audioEl = new Audio();
        audioEl.src = url;
        audioEl.preload = 'auto';
        useMediaStore.getState().register(assetId, audioEl);
        addToTimeline(assetId, type, mediaDuration);
        decodeAndExtractPeaks(assetId, url).then((peaks) => {
          useMediaStore.getState().registerWaveform(assetId, peaks);
        }).catch(() => {/* non-fatal */});
      } else {
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
          size,
          dateAdded,
        });

        useMediaStore.getState().register(assetId, img);
        setThumbnails((prev) => ({ ...prev, [assetId]: url }));
        addToTimeline(assetId, type, 5);
      }
    }
  }, []);

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
    const { clips, removeClip } = useTimelineStore.getState();
    for (const clip of Object.values(clips)) {
      if (clip.assetId === assetId) removeClip(clip.id);
    }
    useMediaStore.getState().unregister(assetId);
    evictAudioBuffer(assetId);
    useProjectStore.getState().removeAsset(assetId);
    setThumbnails((prev) => {
      const { [assetId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const dragHandlers = useCallback((asset: MediaAsset) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-asset-id', asset.id);
      e.dataTransfer.setData('application/x-asset-type', asset.type);
      e.dataTransfer.setData('application/x-asset-duration', String(asset.duration));
      e.dataTransfer.effectAllowed = 'copy';
    },
  }), []);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = Object.values(assets);
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q));

    list.sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'type': return (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || a.name.localeCompare(b.name);
        case 'size': return (b.size ?? 0) - (a.size ?? 0);
        case 'date':
        default: return (b.dateAdded ?? 0) - (a.dateAdded ?? 0);
      }
    });
    return list;
  }, [assets, sortBy, searchQuery]);

  const isEmpty = Object.keys(assets).length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Assets</h2>
        <div className="gold-ring-btn cursor-pointer" onClick={handleFileImport}>
          <div className="gold-ring-clip">
            <div className="gold-ring-gradient" />
          </div>
          <div className="gold-ring-inner px-3 py-1 text-[11px] font-semibold text-[var(--text-primary)]">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Import
          </div>
        </div>
      </div>

      {/* Toolbar: search + sort + view toggle */}
      {!isEmpty && (
        <div className="px-2 pt-2 pb-1 flex flex-col gap-1.5 border-b border-[var(--border-color)]">
          {/* Search bar */}
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search assets…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Sort + view toggle row */}
          <div className="flex items-center gap-1.5">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="flex-1 text-[10px] px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]/50 cursor-pointer"
            >
              <option value="date">Sort: Date added</option>
              <option value="name">Sort: Name</option>
              <option value="type">Sort: Type</option>
              <option value="size">Sort: Size</option>
            </select>

            {/* View mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-[var(--border-color)]">
              <button
                onClick={() => setViewMode('grid')}
                title="Grid view"
                className={`px-1.5 py-1 transition-colors ${viewMode === 'grid' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className={`px-1.5 py-1 transition-colors ${viewMode === 'list' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset content */}
      <div className="flex-1 overflow-y-auto p-2 relative">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] text-sm gap-2 p-4">
            <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            <span className="text-center">Drop files here or click Import to add media</span>
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--text-muted)] text-xs gap-1">
            <span>No assets match &ldquo;{searchQuery}&rdquo;</span>
          </div>
        ) : viewMode === 'grid' ? (
          <GridView
            assets={filteredAndSorted}
            thumbnails={thumbnails}
            dragHandlers={dragHandlers}
            onRemove={handleRemoveAsset}
          />
        ) : (
          <ListView
            assets={filteredAndSorted}
            thumbnails={thumbnails}
            dragHandlers={dragHandlers}
            onRemove={handleRemoveAsset}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Grid View ─────────────────────────────────────────────────────────────── */

function GridView({
  assets,
  thumbnails,
  dragHandlers,
  onRemove,
}: {
  assets: MediaAsset[];
  thumbnails: Record<string, string>;
  dragHandlers: (asset: MediaAsset) => { draggable: true; onDragStart: (e: React.DragEvent) => void };
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {assets.map((asset) => (
        <div
          key={asset.id}
          {...dragHandlers(asset)}
          className="p-2 rounded-xl bg-[var(--bg-tertiary)] cursor-grab active:cursor-grabbing border border-[var(--border-color)] hover:border-[var(--accent)]/30 hover-glow btn-press transition-colors relative group"
        >
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(asset.id); }}
            className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-[var(--bg-secondary)]/80 hover:bg-red-600 text-[var(--text-secondary)] hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
            title="Remove asset"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="w-full aspect-video bg-[var(--bg-secondary)] rounded-lg mb-1.5 flex items-center justify-center overflow-hidden relative">
            {thumbnails[asset.id] ? (
              <img src={thumbnails[asset.id]} alt={asset.name} className="w-full h-full object-cover" />
            ) : (
              <TypeIcon type={asset.type} className="w-6 h-6" />
            )}
            <span className="absolute bottom-0.5 right-0.5 text-[9px] bg-black/70 px-1 rounded text-[var(--text-secondary)]">
              {secondsToDisplay(asset.duration)}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] truncate">{asset.name}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── List View ─────────────────────────────────────────────────────────────── */

function ListView({
  assets,
  thumbnails,
  dragHandlers,
  onRemove,
}: {
  assets: MediaAsset[];
  thumbnails: Record<string, string>;
  dragHandlers: (asset: MediaAsset) => { draggable: true; onDragStart: (e: React.DragEvent) => void };
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {assets.map((asset) => (
        <div
          key={asset.id}
          {...dragHandlers(asset)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] cursor-grab active:cursor-grabbing border border-[var(--border-color)] hover:border-[var(--accent)]/30 hover-glow btn-press transition-colors relative group"
        >
          {/* Thumbnail / icon */}
          <div className="w-10 h-7 rounded bg-[var(--bg-secondary)] flex items-center justify-center overflow-hidden flex-shrink-0">
            {thumbnails[asset.id] ? (
              <img src={thumbnails[asset.id]} alt={asset.name} className="w-full h-full object-cover" />
            ) : (
              <TypeIcon type={asset.type} className="w-4 h-4" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--text-primary)] truncate leading-tight">{asset.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[10px] font-medium ${TYPE_COLORS[asset.type]}`}>
                {TYPE_LABELS[asset.type]}
              </span>
              <span className="text-[var(--text-muted)] text-[10px]">·</span>
              <span className="text-[10px] text-[var(--text-muted)]">{secondsToDisplay(asset.duration)}</span>
              <span className="text-[var(--text-muted)] text-[10px]">·</span>
              <span className="text-[10px] text-[var(--text-muted)]">{formatFileSize(asset.size)}</span>
            </div>
          </div>

          {/* Delete */}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(asset.id); }}
            className="w-5 h-5 rounded-full bg-[var(--bg-secondary)]/80 hover:bg-red-600 text-[var(--text-secondary)] hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
            title="Remove asset"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── Timeline helpers (unchanged) ─────────────────────────────────────────── */

function addToTimeline(assetId: string, type: 'video' | 'audio' | 'image', mediaDuration: number) {
  const { trackOrder, tracks, selectedTrackId, addTrack } = useTimelineStore.getState();

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
      targetTrackId = trackOrder.find((tid) => tracks[tid]?.type === 'overlay');
      if (!targetTrackId) targetTrackId = addTrack('overlay', 'Overlay');
    } else {
      targetTrackId = trackOrder.find((tid) => {
        const track = tracks[tid];
        if (type === 'audio') return track.type === 'audio';
        return track.type === 'video';
      });
    }
  }

  if (!targetTrackId) {
    targetTrackId = addTrack(type === 'audio' ? 'audio' : 'video');
  }

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
    el.preload = 'auto';
    let resolved = false;

    const tryResolve = () => {
      if (resolved) return;
      const dur = el.duration;
      if (!dur || !isFinite(dur) || dur <= 0) return;
      resolved = true;
      resolve({ duration: dur, width: el.videoWidth || 1920, height: el.videoHeight || 1080 });
      el.removeEventListener('durationchange', tryResolve);
      el.removeEventListener('loadeddata', tryResolve);
    };

    el.onloadedmetadata = tryResolve;
    el.addEventListener('durationchange', tryResolve);
    el.addEventListener('loadeddata', tryResolve);
    el.onerror = () => {
      if (!resolved) { resolved = true; resolve({ duration: 5, width: 1920, height: 1080 }); }
    };
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const dur = el.duration;
        resolve({
          duration: isFinite(dur) && dur > 0 ? dur : 30,
          width: el.videoWidth || 1920,
          height: el.videoHeight || 1080,
        });
      }
    }, 5000);
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
