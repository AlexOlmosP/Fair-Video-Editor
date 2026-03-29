'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { getTimelineDuration, renderExportFrames } from '@/engine/export/canvasExporter';
import { FFmpegWorker } from '@/engine/ffmpeg/FFmpegWorker';
import type { Clip, Track } from '@/store/types';
import {
  RESOLUTION_PRESETS,
  FRAME_RATE_OPTIONS,
  QUALITY_PRESETS_MAP,
  DEFAULT_EXPORT_SETTINGS,
  type ExportFormat,
  type ExportCodec,
  type ExportSettings,
} from '@/engine/types';

/** Derive initial export settings from the current project settings */
const RESOLUTION_DEFAULT_BITRATE: Record<string, string> = {
  '720p': '6000k',
  '1080p': '10000k',
  '2k': '18000k',
  '4k': '40000k',
};

function deriveDefaultSettings(): ExportSettings {
  const { settings } = useProjectStore.getState();
  let bestKey = DEFAULT_EXPORT_SETTINGS.resolutionKey;
  let bestDiff = Infinity;
  for (const [key, preset] of Object.entries(RESOLUTION_PRESETS)) {
    const diff = Math.abs(preset.width - settings.width) + Math.abs(preset.height - settings.height);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }
  const frameRate = (FRAME_RATE_OPTIONS as readonly number[]).includes(settings.frameRate)
    ? settings.frameRate
    : DEFAULT_EXPORT_SETTINGS.frameRate;
  const videoBitrate = RESOLUTION_DEFAULT_BITRATE[bestKey] ?? DEFAULT_EXPORT_SETTINGS.videoBitrate;
  return { ...DEFAULT_EXPORT_SETTINGS, resolutionKey: bestKey, frameRate, videoBitrate };
}

interface ExportModalProps {
  onClose: () => void;
}

/** Encode an AudioBuffer as a 16-bit stereo WAV Uint8Array */
function audioBufferToWav(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate  = audioBuffer.sampleRate;
  const bitDepth    = 16;
  const blockAlign  = numChannels * (bitDepth / 8);

  // Interleave all channels
  const interleaved = new Float32Array(audioBuffer.length * numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    for (let i = 0; i < audioBuffer.length; i++) {
      interleaved[i * numChannels + ch] = src[i];
    }
  }

  // Float32 → Int16 PCM
  const pcm = new Int16Array(interleaved.length);
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const dataBytes = pcm.byteLength;
  const wav  = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);

  wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataBytes, true);
  wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  wav.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  wav.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataBytes, true);
  wav.set(new Uint8Array(pcm.buffer), 44);

  return wav;
}

/**
 * Decode each video clip's audio via OfflineAudioContext and mix them down
 * into a single stereo AudioBuffer at the project sample rate.
 * Returns null when there is nothing to mix (no audio, all muted, etc.).
 */
async function mixAudioTracks(
  clips: Record<string, Clip>,
  tracks: Record<string, Track>,
  elements: Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>,
  totalDuration: number,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  // Video and audio elements on non-muted, visible tracks can carry audio
  const candidates = Object.values(clips).filter((clip) => {
    if (!clip.visible || clip.textData || clip.transitionData) return false;
    const track = tracks[clip.trackId];
    if (!track || track.muted) return false;
    const el = elements[clip.assetId];
    return (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) && Boolean(el.src);
  });

  if (candidates.length === 0) return null;

  const totalSamples = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const offlineCtx   = new OfflineAudioContext(2, totalSamples, sampleRate);

  let hasAudio = false;

  for (const clip of candidates) {
    const el = elements[clip.assetId] as HTMLVideoElement | HTMLAudioElement;
    try {
      const response = await fetch(el.src);
      if (!response.ok) continue;

      const arrayBuf = await response.arrayBuffer();
      let audioBuf: AudioBuffer;
      try {
        audioBuf = await offlineCtx.decodeAudioData(arrayBuf);
      } catch {
        continue; // Video has no audio track or codec is unsupported
      }

      if (audioBuf.numberOfChannels === 0 || audioBuf.duration === 0) continue;

      const source = offlineCtx.createBufferSource();
      source.buffer        = audioBuf;
      source.playbackRate.value = Math.max(0.0625, Math.min(16, clip.speed));

      const gain = offlineCtx.createGain();
      gain.gain.value = Math.max(0, Math.min(2, clip.volume));
      source.connect(gain);
      gain.connect(offlineCtx.destination);

      // Timeline position → inPoint offset → duration in source time
      source.start(
        Math.max(0, clip.startTime),
        Math.max(0, clip.inPoint),
        clip.duration * clip.speed,
      );
      hasAudio = true;
    } catch {
      // Blob URL inaccessible or other transient error — skip silently
    }
  }

  if (!hasAudio) return null;
  return offlineCtx.startRendering();
}

/** Compute the codec and file extension for a given format */
function getFormatConfig(format: ExportFormat): { codec: ExportCodec; ext: string; mime: string; outputCodecArgs: string[] } {
  switch (format) {
    case 'webm':
      return {
        codec: 'libvpx-vp9',
        ext: 'webm',
        mime: 'video/webm',
        outputCodecArgs: ['-c:v', 'libvpx-vp9', '-row-mt', '1'],
      };
    case 'mp4':
    default:
      return {
        codec: 'libx264',
        ext: 'mp4',
        mime: 'video/mp4',
        outputCodecArgs: ['-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p'],
      };
  }
}

/** Rough file size estimate in MB */
function estimateFileSize(
  durationSec: number,
  videoBitrateK: number,
  audioBitrateK: number,
): number {
  return ((videoBitrateK + audioBitrateK) * durationSec) / 8 / 1024;
}

const RESOLUTION_BITRATE_HINTS: Record<string, string> = {
  '720p':  'Recommended: 5–8 Mbps',
  '1080p': 'Recommended: 8–12 Mbps',
  '2k':    'Recommended: 16–20 Mbps',
  '4k':    'Recommended: 35–45 Mbps',
};

export function ExportModal({ onClose }: ExportModalProps) {
  const [exportSettings, setExportSettings] = useState<ExportSettings>(deriveDefaultSettings);
  const [qualityKey, setQualityKey] = useState('high');
  const [customBitrateMbps, setCustomBitrateMbps] = useState(() => {
    const kbps = parseInt(exportSettings.videoBitrate) || 10000;
    return String(kbps / 1000);
  });
  const [isExporting,    setIsExporting]    = useState(false);
  const [exportStage,    setExportStage]    = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [frameInfo,      setFrameInfo]      = useState<{ current: number; total: number } | null>(null);
  const [etaSeconds,     setEtaSeconds]     = useState<number | null>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const exportStartRef = useRef<number>(0);

  const updateSetting = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => {
    setExportSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleQualityChange = (key: string) => {
    setQualityKey(key);
    const preset = QUALITY_PRESETS_MAP[key];
    if (preset) {
      setExportSettings((prev) => ({
        ...prev,
        videoBitrate: preset.videoBitrate,
        audioBitrate: preset.audioBitrate,
      }));
      const kbps = parseInt(preset.videoBitrate) || 12000;
      setCustomBitrateMbps(String(kbps / 1000));
    }
  };

  const handleBitrateMbpsChange = (val: string) => {
    setCustomBitrateMbps(val);
    const mbps = parseFloat(val);
    if (!isNaN(mbps) && mbps > 0) {
      updateSetting('videoBitrate', `${Math.round(mbps * 1000)}k`);
    }
  };

  const handleFormatChange = (format: ExportFormat) => {
    const config = getFormatConfig(format);
    setExportSettings((prev) => ({
      ...prev,
      format,
      codec: config.codec,
    }));
  };

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleExport = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setIsExporting(true);
    setExportProgress(0);
    setExportStage('');
    setFrameInfo(null);
    setEtaSeconds(null);

    const ffmpegFiles: string[] = [];

    try {
      const { setIsPlaying } = useTimelineStore.getState();
      setIsPlaying(false);

      const { clips, tracks, trackOrder } = useTimelineStore.getState();
      const { elements }  = useMediaStore.getState();
      const { settings }  = useProjectStore.getState();

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

      // Resolve export dimensions from selected resolution preset
      const resPre = RESOLUTION_PRESETS[exportSettings.resolutionKey] ?? RESOLUTION_PRESETS['1080p'];
      // Maintain project aspect ratio: scale to fit within chosen resolution
      const projectAR = settings.width / settings.height;
      const targetAR  = resPre.width / resPre.height;
      let exportW: number, exportH: number;
      if (projectAR >= targetAR) {
        exportW = resPre.width;
        exportH = Math.round(resPre.width / projectAR);
      } else {
        exportH = resPre.height;
        exportW = Math.round(resPre.height * projectAR);
      }
      // Ensure even dimensions
      exportW = exportW - (exportW % 2);
      exportH = exportH - (exportH % 2);

      const frameRate  = exportSettings.frameRate;
      const sampleRate = settings.sampleRate;
      const totalFrames = Math.ceil(totalDuration * frameRate);
      if (totalFrames === 0) {
        setExportStage('Timeline is empty');
        setIsExporting(false);
        return;
      }

      // ── 1. Load FFmpeg WASM ──────────────────────────────────────────────
      setExportStage('Loading encoder...');
      setExportProgress(2);

      const ffmpeg = FFmpegWorker.getInstance();
      await ffmpeg.load();
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      ffmpeg.onProgress((p) => {
        setExportProgress(80 + Math.round(p * 0.17));
      });

      // ── 2. Render every frame as JPEG into the FFmpeg virtual FS ─────────
      exportStartRef.current = Date.now();
      await renderExportFrames({
        width: exportW,
        height: exportH,
        projectWidth:  settings.width,
        projectHeight: settings.height,
        frameRate,
        backgroundColor: settings.backgroundColor,
        clips,
        tracks,
        trackOrder,
        elements: elements as Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>,
        totalDuration,
        signal,
        onProgress: (_stage, frame, total) => {
          setExportStage('Rendering frames...');
          setFrameInfo({ current: frame + 1, total });
          setExportProgress(5 + Math.round((frame / total) * 60));
          const elapsed = (Date.now() - exportStartRef.current) / 1000;
          if (elapsed > 0 && frame > 0) {
            const rate = (frame + 1) / elapsed;
            setEtaSeconds((total - frame - 1) / rate);
          }
        },
        writeFrame: async (name, blob) => {
          await ffmpeg.writeFile(name, blob);
          ffmpegFiles.push(name);
        },
      });

      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      // ── 3. Mix audio tracks ───────────────────────────────────────────────
      setExportStage('Encoding audio...');
      setExportProgress(68);
      setFrameInfo(null);
      setEtaSeconds(null);

      let hasAudio = false;
      try {
        const audioBuf = await mixAudioTracks(
          clips,
          tracks,
          elements as Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>,
          totalDuration,
          sampleRate,
        );
        if (audioBuf) {
          const wavData = audioBufferToWav(audioBuf);
          await ffmpeg.writeFile('audio.wav', new Blob([wavData.buffer as ArrayBuffer]));
          ffmpegFiles.push('audio.wav');
          hasAudio = true;
        }
      } catch (audioErr) {
        console.warn('Audio mixing failed — exporting video-only:', audioErr);
      }

      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      // ── 4. Encode with FFmpeg ─────────────────────────────────────────────
      const formatCfg = getFormatConfig(exportSettings.format);
      const outputName = `output.${formatCfg.ext}`;

      setExportStage('Muxing video...');
      setExportProgress(80);

      const args: string[] = [
        '-framerate', String(frameRate),
        '-i', 'frame_%06d.jpg',
      ];
      if (hasAudio) {
        args.push('-i', 'audio.wav');
      }
      args.push(...formatCfg.outputCodecArgs);
      args.push('-b:v', exportSettings.videoBitrate);
      if (exportSettings.bitrateMode === 'cbr') {
        args.push('-maxrate', exportSettings.videoBitrate);
        const kbps = parseInt(exportSettings.videoBitrate) || 12000;
        args.push('-bufsize', `${kbps * 2}k`);
      }
      if (hasAudio) {
        args.push(
          '-c:a', exportSettings.format === 'webm' ? 'libopus' : 'aac',
          '-b:a', exportSettings.audioBitrate,
          '-map', '0:v', '-map', '1:a',
        );
      }
      if (exportSettings.format === 'mp4') {
        args.push('-movflags', '+faststart');
      }
      args.push(outputName);

      await ffmpeg.exec(args, signal);

      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      // ── 5. Read output and trigger browser download ──────────────────────
      setExportStage('Finalizing...');
      setExportProgress(97);

      const outputData = await ffmpeg.readFile(outputName);
      if (!outputData || outputData.byteLength === 0) {
        throw new Error('Export produced an empty file.');
      }

      const blob = new Blob([outputData.buffer as ArrayBuffer], { type: formatCfg.mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${settings.name || 'export'}.${formatCfg.ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportProgress(100);
      setExportStage('Complete!');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setExportStage('Export cancelled.');
        setExportProgress(0);
      } else {
        console.error('Export error:', err);
        setExportStage(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } finally {
      const ffmpeg = FFmpegWorker.getInstance();
      for (const file of ffmpegFiles) {
        try { await ffmpeg.deleteFile(file); } catch { /* already gone */ }
      }
      const formatCfg = getFormatConfig(exportSettings.format);
      try { await ffmpeg.deleteFile(`output.${formatCfg.ext}`); } catch { /* already gone */ }
      setIsExporting(false);
      setFrameInfo(null);
      setEtaSeconds(null);
      abortRef.current = null;
    }
  }, [exportSettings, onClose]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef   = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tl = gsap.timeline();
    tl.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
    tl.fromTo(
      modalRef.current,
      { opacity: 0, scale: 0.95, y: 12 },
      { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.4)' },
      '-=0.15',
    );
  }, []);

  const clips = useTimelineStore((s) => s.clips);
  const totalDuration = getTimelineDuration(clips);

  // Estimate file size
  const vBitrate = parseInt(exportSettings.videoBitrate) || 12000;
  const aBitrate = parseInt(exportSettings.audioBitrate) || 192;
  const estSizeMB = estimateFileSize(totalDuration, vBitrate, aBitrate);

  const resPre = RESOLUTION_PRESETS[exportSettings.resolutionKey];

  // Shared Tailwind classes
  const selectCls = 'w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer [&>option]:bg-[var(--bg-tertiary)] [&>option]:text-[var(--text-primary)]';
  const labelCls  = 'block text-xs font-medium text-[var(--text-muted)] mb-1.5';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !isExporting) onClose(); }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1a1a2e] p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Export Video</h2>
          {!isExporting && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* ── Settings Grid ─────────────────────────────────────────────── */}
        <div className={`space-y-4 ${isExporting ? 'pointer-events-none opacity-50' : ''}`}>
          {/* Row 1: Format + Resolution */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Format</label>
              <select
                value={exportSettings.format}
                onChange={(e) => handleFormatChange(e.target.value as ExportFormat)}
                className={selectCls}
              >
                <option value="mp4">MP4 (H.264 + AAC)</option>
                <option value="webm">WebM (VP9 + Opus)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Resolution</label>
              <select
                value={exportSettings.resolutionKey}
                onChange={(e) => {
                  const key = e.target.value;
                  updateSetting('resolutionKey', key);
                  const autoBitrate = RESOLUTION_DEFAULT_BITRATE[key];
                  if (autoBitrate) {
                    updateSetting('videoBitrate', autoBitrate);
                    setCustomBitrateMbps(String(parseInt(autoBitrate) / 1000));
                  }
                }}
                className={selectCls}
              >
                {Object.entries(RESOLUTION_PRESETS).map(([key, p]) => (
                  <option key={key} value={key}>{p.label} ({p.width}×{p.height})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Frame Rate + Quality */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Frame Rate</label>
              <select
                value={exportSettings.frameRate}
                onChange={(e) => updateSetting('frameRate', Number(e.target.value))}
                className={selectCls}
              >
                {FRAME_RATE_OPTIONS.map((fps) => (
                  <option key={fps} value={fps}>{fps} fps</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Quality</label>
              <select
                value={qualityKey}
                onChange={(e) => handleQualityChange(e.target.value)}
                className={selectCls}
              >
                {Object.entries(QUALITY_PRESETS_MAP).map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Bitrate Mode + Custom Bitrate */}
          <div>
            <label className={labelCls}>Bitrate Control</label>
            <div className="flex items-center gap-2">
              {/* VBR / CBR toggle */}
              <div className="flex rounded-lg border border-white/10 overflow-hidden">
                {(['vbr', 'cbr'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updateSetting('bitrateMode', mode)}
                    className={`px-4 py-2 text-xs font-medium transition-colors ${
                      exportSettings.bitrateMode === mode
                        ? 'bg-blue-600 text-white'
                        : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Custom bitrate input */}
              <div className="flex-1 flex items-center gap-1.5">
                <input
                  type="number"
                  min="0.5"
                  max="200"
                  step="0.5"
                  value={customBitrateMbps}
                  onChange={(e) => handleBitrateMbpsChange(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 outline-none focus:border-blue-500 transition-colors"
                />
                <span className="text-xs text-white/40 whitespace-nowrap">Mbps</span>
              </div>
            </div>
            {/* Hint */}
            <p className="mt-1.5 text-[11px] text-white/30">
              {RESOLUTION_BITRATE_HINTS[exportSettings.resolutionKey] ?? ''}
              {exportSettings.bitrateMode === 'cbr' ? ' · CBR enforces strict bitrate ceiling' : ' · VBR targets bitrate, varies per scene'}
            </p>
          </div>

          {/* Info strip */}
          <div className="flex items-center gap-4 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/50">
            <span>Output: {resPre?.width}×{resPre?.height}</span>
            <span className="text-white/20">|</span>
            <span>Duration: {totalDuration.toFixed(1)}s</span>
            <span className="text-white/20">|</span>
            <span>Est. size: ~{estSizeMB < 1 ? `${(estSizeMB * 1024).toFixed(0)} KB` : `${estSizeMB.toFixed(1)} MB`}</span>
          </div>
        </div>

        {/* ── Progress ──────────────────────────────────────────────────── */}
        {isExporting && (
          <div className="mt-5 space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/60">{exportStage}</span>
              <span className="font-mono text-white/40">{exportProgress}%</span>
            </div>
            {frameInfo && (
              <div className="flex items-center justify-between text-xs text-white/35">
                <span>Frame {frameInfo.current} / {frameInfo.total}</span>
                {etaSeconds !== null && etaSeconds > 1 && (
                  <span>
                    ~{etaSeconds < 60
                      ? `${Math.ceil(etaSeconds)}s`
                      : `${Math.floor(etaSeconds / 60)}m ${Math.ceil(etaSeconds % 60)}s`
                    } remaining
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {isExporting ? (
            <button
              onClick={handleCancel}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Cancel Export
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg px-5 py-2.5 text-sm font-medium text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                className="rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg hover:from-blue-500 hover:to-purple-500 transition-all"
              >
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
