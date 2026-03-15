'use client';

import React, { useState, useCallback } from 'react';
import { EXPORT_PRESETS } from '@/engine/ffmpeg/config';
import { useFFmpeg } from '@/hooks/useFFmpeg';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { ASPECT_RATIO_PRESETS, getExportDimensions } from '@/lib/constants';
import { renderExportFrames, getTimelineDuration } from '@/engine/export/canvasExporter';

interface ExportModalProps {
  onClose: () => void;
}

export function ExportModal({ onClose }: ExportModalProps) {
  const [selectedPreset, setSelectedPreset] = useState('1080p');
  const [selectedRatio, setSelectedRatio] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const { isLoaded, isLoading, error, load, exec, writeFile, readFile } = useFFmpeg();

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

      // Phase 1: Render video frames from canvas at the correct aspect ratio
      setExportStage('Rendering frames...');
      const exportDims = getExportDimensions(selectedPreset, selectedRatio, preset.width, preset.height);

      const totalFrames = await renderExportFrames({
        width: exportDims.width,
        height: exportDims.height,
        frameRate: preset.frameRate,
        backgroundColor: settings.backgroundColor,
        clips,
        tracks,
        trackOrder,
        elements: elements as Record<string, HTMLVideoElement | HTMLImageElement>,
        totalDuration,
        onProgress: (stage, frame, total) => {
          setExportStage(`Rendering frame ${frame}/${total}`);
          setExportProgress(Math.round((frame / total) * 50)); // 0-50% for rendering
        },
        writeFrame: async (name, blob) => {
          await writeFile(name, blob);
        },
      });

      // Phase 2: Encode JPEG sequence to H.264 video
      setExportStage('Encoding video...');
      setExportProgress(50);

      const videoCmd: string[] = [
        '-framerate', String(preset.frameRate),
        '-i', 'frame_%06d.jpg',
        '-c:v', preset.codec,
        '-b:v', preset.videoBitrate,
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ];

      videoCmd.push('-y', 'video_only.mp4');
      await exec(videoCmd);
      setExportProgress(65);

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
      setIsExporting(false);
    }
  }, [selectedPreset, selectedRatio, isLoaded, load, exec, writeFile, readFile, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold">Export Video</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preset Selection */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Quality Preset</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(EXPORT_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => setSelectedPreset(key)}
                  className={`px-3 py-2 rounded text-sm text-left transition-colors ${
                    selectedPreset === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
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
            <label className="block text-xs text-zinc-400 mb-2">Aspect Ratio</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setSelectedRatio(null)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  selectedRatio === null
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                Native
              </button>
              {ASPECT_RATIO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setSelectedRatio(preset.label)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    selectedRatio === preset.label
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
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
                <span className="text-zinc-400">{exportStage}</span>
                {isExporting && exportProgress > 0 && (
                  <span className="text-zinc-300 font-mono">{exportProgress}%</span>
                )}
              </div>
              {isExporting && (
                <div className="w-full bg-zinc-800 rounded-full h-1.5">
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
        <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isExporting ? 'Exporting...' : isLoading ? 'Loading FFmpeg...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
