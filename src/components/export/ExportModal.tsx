'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useFFmpeg } from '@/hooks/useFFmpeg';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { renderExportFrames, getTimelineDuration } from '@/engine/export/canvasExporter';

const QUALITY_PRESETS = [
  { key: 'standard', label: 'Standard', codec: 'libx264', videoBitrate: '5000k', audioBitrate: '128k' },
  { key: 'high', label: 'High', codec: 'libx264', videoBitrate: '10000k', audioBitrate: '192k' },
  { key: 'ultra', label: 'Ultra', codec: 'libx264', videoBitrate: '20000k', audioBitrate: '256k' },
];

interface ExportModalProps {
  onClose: () => void;
}

export function ExportModal({ onClose }: ExportModalProps) {
  const [selectedQuality, setSelectedQuality] = useState('high');
  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const { isLoaded, isLoading, error, load, exec, writeFile, readFile, setOnProgress } = useFFmpeg();

  const handleExport = useCallback(async () => {
    const quality = QUALITY_PRESETS.find((q) => q.key === selectedQuality) || QUALITY_PRESETS[1];

    setIsExporting(true);
    setExportProgress(0);

    try {
      if (!isLoaded) {
        setExportStage('Loading FFmpeg...');
        await load();
      }

      const { setIsPlaying } = useTimelineStore.getState();
      setIsPlaying(false);

      const { clips, tracks, trackOrder } = useTimelineStore.getState();
      const { assets } = useProjectStore.getState();
      const { elements } = useMediaStore.getState();
      const { settings } = useProjectStore.getState();

      const clipList = Object.values(clips);
      if (clipList.length === 0) {
        setExportStage('No clips to export');
        setIsExporting(false);
        return;
      }

      const totalDuration = getTimelineDuration(clips);
      if (totalDuration <= 0) {
        setExportStage('Timeline is empty');
        setIsExporting(false);
        return;
      }

      // Use project dimensions and FPS directly from Settings
      const width = settings.width;
      const height = settings.height;
      const frameRate = settings.frameRate;

      setExportStage('Rendering frames...');

      const exportOpts = {
        width,
        height,
        projectWidth: width,
        projectHeight: height,
        frameRate,
        backgroundColor: settings.backgroundColor,
        clips,
        tracks,
        trackOrder,
        elements: elements as Record<string, HTMLVideoElement | HTMLImageElement>,
        totalDuration,
        onProgress: (stage: string, frame: number, total: number) => {
          setExportStage(`${stage} ${frame}/${total}`);
          setExportProgress(Math.round((frame / total) * 60));
        },
        writeFrame: async (name: string, blob: Blob) => {
          await writeFile(name, blob);
        },
      };

      // Render JPEG frames + encode with FFmpeg (reliable path)
      setExportStage('Rendering frames...');
      const totalFrames = await renderExportFrames(exportOpts);

      if (totalFrames === 0) {
        setExportStage('No frames rendered');
        setIsExporting(false);
        return;
      }

      setExportStage('Encoding video...');
      setExportProgress(60);

      // Encode directly from JPEG image sequence (no concat demuxer — simpler, more reliable)
      setOnProgress((p) => {
        setExportProgress(60 + Math.round((p / 100) * 5));
        setExportStage(`Encoding video... ${p}%`);
      });

      await exec([
        '-framerate', String(frameRate),
        '-i', 'frame_%06d.jpg',
        '-c:v', quality.codec,
        '-b:v', quality.videoBitrate,
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-movflags', '+faststart',
        '-y', 'video_only.mp4',
      ]);
      setOnProgress(null);
      setExportProgress(65);

      // Cleanup frame files to free WASM memory before audio processing
      const worker = (await import('@/engine/ffmpeg/FFmpegWorker')).FFmpegWorker.getInstance();
      for (let i = 0; i < totalFrames; i++) {
        try { await worker.deleteFile(`frame_${String(i).padStart(6, '0')}.jpg`); } catch {}
      }

      // Audio
      const audioClips = clipList.filter((c) => {
        if (c.transitionData || c.textData) return false;
        const asset = assets[c.assetId];
        return asset && (asset.type === 'video' || asset.type === 'audio') && c.volume > 0;
      });

      let hasAudio = false;
      if (audioClips.length > 0) {
        setExportStage('Processing audio...');
        const writtenAssets = new Set<string>();
        for (const clip of audioClips) {
          if (writtenAssets.has(clip.assetId)) continue;
          const asset = assets[clip.assetId];
          if (!asset) continue;
          try {
            const response = await fetch(asset.src);
            const blob = await response.blob();
            await writeFile(`src_${clip.assetId.slice(0, 8)}.mp4`, blob);
            writtenAssets.add(clip.assetId);
          } catch {}
        }

        if (writtenAssets.size > 0) {
          const inputs: string[] = [];
          const filterParts: string[] = [];
          const mixInputs: string[] = [];

          audioClips.forEach((clip, idx) => {
            if (!writtenAssets.has(clip.assetId)) return;
            inputs.push('-i', `src_${clip.assetId.slice(0, 8)}.mp4`);
            const inPoint = clip.inPoint;
            const outPoint = clip.inPoint + clip.duration * clip.speed;
            const delayMs = Math.round(clip.startTime * 1000);
            const label = `a${idx}`;
            let filter = `[${idx}:a]atrim=start=${inPoint.toFixed(3)}:end=${outPoint.toFixed(3)}`;
            if (clip.speed !== 1) {
              filter += `,atempo=${Math.max(0.5, Math.min(2.0, clip.speed)).toFixed(3)}`;
            }
            filter += `,adelay=${delayMs}|${delayMs},volume=${clip.volume.toFixed(2)}[${label}]`;
            filterParts.push(filter);
            mixInputs.push(`[${label}]`);
          });

          if (filterParts.length > 0) {
            try {
              await exec([
                ...inputs,
                '-filter_complex', filterParts.join('; ') + `; ${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`,
                '-map', '[aout]', '-c:a', 'aac', '-b:a', quality.audioBitrate, '-y', 'audio_mix.aac',
              ]);
              hasAudio = true;
            } catch {
              console.warn('Audio mixing failed, exporting video only');
            }
          }
        }
      }

      setExportProgress(80);

      const outputFile = 'output.mp4';
      if (hasAudio) {
        setExportStage('Muxing audio and video...');
        await exec(['-i', 'video_only.mp4', '-i', 'audio_mix.aac', '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', '-y', outputFile]);
      } else {
        await exec(['-i', 'video_only.mp4', '-c', 'copy', '-y', outputFile]);
      }

      setExportProgress(90);

      // Cleanup intermediates
      const cleanup = (await import('@/engine/ffmpeg/FFmpegWorker')).FFmpegWorker.getInstance();
      try { await cleanup.deleteFile('video_only.mp4'); } catch {}
      try { await cleanup.deleteFile('audio_mix.aac'); } catch {}
      for (const clip of audioClips) {
        try { await cleanup.deleteFile(`src_${clip.assetId.slice(0, 8)}.mp4`); } catch {}
      }

      // Download
      setExportStage('Downloading...');
      const data = await readFile(outputFile);
      if (data.length === 0) throw new Error('Export produced an empty file.');

      const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${settings.name || 'export'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      try { await cleanup.deleteFile(outputFile); } catch {}

      setExportProgress(100);
      setExportStage('Export complete!');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      console.error('Export error:', err);
      setExportStage(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setOnProgress(null);
      setIsExporting(false);
    }
  }, [selectedQuality, isLoaded, load, exec, writeFile, readFile, setOnProgress, onClose]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tl = gsap.timeline();
    tl.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
    tl.fromTo(modalRef.current,
      { opacity: 0, scale: 0.95, y: 12 },
      { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.4)' },
      '-=0.15'
    );
  }, []);

  const settings = useProjectStore((s) => s.settings);

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" style={{ opacity: 0 }} onClick={onClose}>
      <div
        ref={modalRef}
        className="glass-panel rounded-[1.25rem] w-[380px]"
        style={{ boxShadow: 'var(--modal-shadow)', opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Export Video</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] btn-icon-press">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Output info from Settings */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[var(--bg-tertiary)]">
            <span className="text-xs text-[var(--text-muted)]">Output</span>
            <span className="text-xs font-medium text-[var(--text-primary)] font-mono">
              {settings.width}x{settings.height} @ {settings.frameRate}fps
            </span>
          </div>

          {/* Quality Selection */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-2">Quality</label>
            <div className="flex gap-2">
              {QUALITY_PRESETS.map((q) => (
                <button
                  key={q.key}
                  onClick={() => setSelectedQuality(q.key)}
                  className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium btn-press transition-colors ${
                    selectedQuality === q.key
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
              Bitrate: {QUALITY_PRESETS.find((q) => q.key === selectedQuality)?.videoBitrate}
            </p>
          </div>

          {/* Progress */}
          {(isExporting || exportStage) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{exportStage}</span>
                {isExporting && exportProgress > 0 && (
                  <span className="text-[var(--text-muted)] font-mono">{exportProgress}%</span>
                )}
              </div>
              {isExporting && (
                <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[var(--accent)] h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(exportProgress, 2)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--glass-border)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] btn-press text-[var(--text-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-5 py-2 text-xs rounded-xl bg-[var(--accent-export)] hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-white btn-press"
            style={{ boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)' }}
          >
            {isExporting ? 'Exporting...' : isLoading ? 'Loading...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
