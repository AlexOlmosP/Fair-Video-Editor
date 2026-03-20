'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { EXPORT_PRESETS } from '@/engine/ffmpeg/config';
import { useFFmpeg } from '@/hooks/useFFmpeg';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { ASPECT_RATIO_PRESETS, getExportDimensions } from '@/lib/constants';
import { renderExportFrames, renderExportWithWebCodecs, getTimelineDuration } from '@/engine/export/canvasExporter';

interface ExportModalProps {
  onClose: () => void;
}

export function ExportModal({ onClose }: ExportModalProps) {
  const [selectedPreset, setSelectedPreset] = useState('1080p');
  const [selectedRatio, setSelectedRatio] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const { isLoaded, isLoading, error, load, exec, writeFile, readFile, setOnProgress } = useFFmpeg();

  const handleExport = useCallback(async () => {
    const preset = EXPORT_PRESETS[selectedPreset];
    if (!preset) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      // Load FFmpeg if not already loaded
      if (!isLoaded) {
        setExportStage('Loading FFmpeg...');
        await load();
      }

      // Pause playback
      const { setIsPlaying } = useTimelineStore.getState();
      setIsPlaying(false);

      // Gather timeline state
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

      // Phase 1+2: Render and encode video
      setExportStage('Rendering frames...');
      const exportDims = getExportDimensions(selectedPreset, selectedRatio, preset.width, preset.height);

      const exportOpts = {
        width: exportDims.width,
        height: exportDims.height,
        projectWidth: settings.width,
        projectHeight: settings.height,
        frameRate: preset.frameRate,
        backgroundColor: settings.backgroundColor,
        clips,
        tracks,
        trackOrder,
        elements: elements as Record<string, HTMLVideoElement | HTMLImageElement>,
        totalDuration,
        onProgress: (stage: string, frame: number, total: number) => {
          setExportStage(`${stage} ${frame}/${total}`);
          setExportProgress(Math.round((frame / total) * 60)); // 0-60% for render+encode
        },
        writeFrame: async (name: string, blob: Blob) => {
          await writeFile(name, blob);
        },
      };

      // Try WebCodecs first (hardware-accelerated, non-blocking)
      let webCodecsBlob: Blob | null = null;
      try {
        setExportStage('Encoding with WebCodecs...');
        webCodecsBlob = await renderExportWithWebCodecs(exportOpts);
      } catch {
        webCodecsBlob = null;
      }

      if (webCodecsBlob && webCodecsBlob.size > 0) {
        // WebCodecs succeeded — write raw bitstream, wrap in MP4 container via FFmpeg
        setExportStage('Wrapping in MP4 container...');
        setExportProgress(62);
        await writeFile('raw_video.h264', webCodecsBlob);
        await exec([
          '-f', 'h264',
          '-framerate', String(preset.frameRate),
          '-i', 'raw_video.h264',
          '-c:v', 'copy',
          '-movflags', '+faststart',
          '-y', 'video_only.mp4',
        ]);
        setExportProgress(65);
      } else {
        // Fallback: render JPEG frames + encode with FFmpeg
        setExportStage('Rendering frames...');
        const totalFrames = await renderExportFrames(exportOpts);

        setExportStage('Encoding video...');
        setExportProgress(60);

        setOnProgress((ffmpegProgress) => {
          const overall = 60 + Math.round((ffmpegProgress / 100) * 5);
          setExportProgress(overall);
          setExportStage(`Encoding video... ${ffmpegProgress}%`);
        });

        // Build concat demuxer file
        const frameDuration = (1 / preset.frameRate).toFixed(6);
        const concatLines: string[] = [];
        for (let i = 0; i < totalFrames; i++) {
          const frameName = `frame_${String(i).padStart(6, '0')}.jpg`;
          concatLines.push(`file '${frameName}'`);
          concatLines.push(`duration ${frameDuration}`);
        }
        if (totalFrames > 0) {
          concatLines.push(`file 'frame_${String(totalFrames - 1).padStart(6, '0')}.jpg'`);
        }
        await writeFile('frames.txt', new Blob([concatLines.join('\n')], { type: 'text/plain' }));

        // Use mjpeg codec first (fast, no re-encoding), then transcode in a second pass
        await exec([
          '-f', 'concat',
          '-safe', '0',
          '-i', 'frames.txt',
          '-c:v', 'mjpeg',
          '-q:v', '2',
          '-y', 'video_mjpeg.avi',
        ]);
        setOnProgress(null);

        setExportStage('Transcoding to H.264...');
        setOnProgress((ffmpegProgress) => {
          const overall = 62 + Math.round((ffmpegProgress / 100) * 3);
          setExportProgress(overall);
        });

        await exec([
          '-i', 'video_mjpeg.avi',
          '-c:v', preset.codec,
          '-b:v', preset.videoBitrate,
          '-pix_fmt', 'yuv420p',
          '-preset', 'ultrafast',
          '-movflags', '+faststart',
          '-y', 'video_only.mp4',
        ]);
        setOnProgress(null);
        setExportProgress(65);
      }

      // Phase 3: Extract audio from source videos and mix
      const audioClips = clipList.filter((c) => {
        if (c.transitionData || c.textData) return false;
        const asset = assets[c.assetId];
        return asset && (asset.type === 'video' || asset.type === 'audio') && c.volume > 0;
      });

      let hasAudio = false;

      if (audioClips.length > 0) {
        setExportStage('Processing audio...');

        // Write source files for audio extraction
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
          } catch {
            // Skip assets that can't be fetched
          }
        }

        if (writtenAssets.size > 0) {
          // Build FFmpeg filter_complex for audio mixing
          const inputs: string[] = [];
          const filterParts: string[] = [];
          const mixInputs: string[] = [];

          audioClips.forEach((clip, idx) => {
            if (!writtenAssets.has(clip.assetId)) return;
            const srcFile = `src_${clip.assetId.slice(0, 8)}.mp4`;
            inputs.push('-i', srcFile);

            const inPoint = clip.inPoint;
            const outPoint = clip.inPoint + clip.duration * clip.speed;
            const delayMs = Math.round(clip.startTime * 1000);
            const label = `a${idx}`;

            // Trim, set tempo for speed changes, delay to correct position, set volume
            let filter = `[${idx}:a]atrim=start=${inPoint.toFixed(3)}:end=${outPoint.toFixed(3)}`;

            // Apply speed change via atempo (only supports 0.5-2.0 range per filter)
            if (clip.speed !== 1) {
              const speed = Math.max(0.5, Math.min(2.0, clip.speed));
              filter += `,atempo=${speed.toFixed(3)}`;
            }

            filter += `,adelay=${delayMs}|${delayMs}`;
            filter += `,volume=${clip.volume.toFixed(2)}`;
            filter += `[${label}]`;

            filterParts.push(filter);
            mixInputs.push(`[${label}]`);
          });

          if (filterParts.length > 0) {
            const filterComplex = filterParts.join('; ') +
              `; ${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`;

            const audioCmd = [
              ...inputs,
              '-filter_complex', filterComplex,
              '-map', '[aout]',
              '-c:a', 'aac',
              '-b:a', preset.audioBitrate,
              '-y', 'audio_mix.aac',
            ];

            try {
              await exec(audioCmd);
              hasAudio = true;
            } catch {
              // Audio mixing failed — export video only
              console.warn('Audio mixing failed, exporting video only');
            }
          }
        }
      }

      setExportProgress(80);

      // Phase 4: Mux video + audio (or just copy video if no audio)
      const outputFile = 'output.mp4';
      if (hasAudio) {
        setExportStage('Muxing audio and video...');
        await exec([
          '-i', 'video_only.mp4',
          '-i', 'audio_mix.aac',
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-movflags', '+faststart',
          '-y', outputFile,
        ]);
      } else {
        // Just rename video_only to output
        await exec([
          '-i', 'video_only.mp4',
          '-c', 'copy',
          '-y', outputFile,
        ]);
      }

      setExportProgress(90);

      // Phase 5: Download
      setExportStage('Downloading...');
      const data = await readFile(outputFile);

      if (data.length === 0) {
        throw new Error('Export produced an empty file. Check console for FFmpeg errors.');
      }

      const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${useProjectStore.getState().settings.name || 'export'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

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
  }, [selectedPreset, selectedRatio, isLoaded, load, exec, writeFile, readFile, onClose]);

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

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" style={{ opacity: 0 }} onClick={onClose}>
      <div
        ref={modalRef}
        className="glass-panel rounded-[1.25rem] w-[420px]"
        style={{ boxShadow: 'var(--modal-shadow)', opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-base font-semibold">Export Video</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preset Selection */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-2">Quality Preset</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(EXPORT_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => setSelectedPreset(key)}
                  className={`px-3 py-2 rounded-xl text-sm text-left transition-colors btn-press ${
                    selectedPreset === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                  }`}
                >
                  <div className="font-medium">{preset.name}</div>
                  <div className="text-[10px] opacity-60 mt-0.5">
                    {(() => {
                      const dims = getExportDimensions(key, selectedRatio, preset.width, preset.height);
                      return `${dims.width}x${dims.height} ${preset.frameRate}fps`;
                    })()}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio for Export */}
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-2">Aspect Ratio</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setSelectedRatio(null)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors btn-press ${
                  selectedRatio === null
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
                }`}
              >
                Native
              </button>
              {ASPECT_RATIO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setSelectedRatio(preset.label)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors btn-press ${
                    selectedRatio === preset.label
                      ? 'bg-blue-600 text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          {(isExporting || exportStage) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">{exportStage}</span>
                {isExporting && exportProgress > 0 && (
                  <span className="text-[var(--text-secondary)] font-mono">{exportProgress}%</span>
                )}
              </div>
              {isExporting && (
                <div className="w-full bg-[var(--bg-tertiary)] rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(exportProgress, 2)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border-color)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl bg-[var(--bg-tertiary)] hover:bg-[var(--hover-bg)] transition-colors btn-press"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 text-sm rounded-xl bg-[var(--accent-export)] hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium btn-press"
            style={{ boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)' }}
          >
            {isExporting ? 'Exporting...' : isLoading ? 'Loading FFmpeg...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
