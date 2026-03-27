'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { getTimelineDuration, renderFrameToCanvasExport } from '@/engine/export/canvasExporter';

const QUALITY_PRESETS = [
  { key: 'standard', label: 'Standard', bps: 5_000_000 },
  { key: 'high', label: 'High', bps: 12_000_000 },
  { key: 'ultra', label: 'Ultra', bps: 25_000_000 },
];

interface ExportModalProps {
  onClose: () => void;
}

export function ExportModal({ onClose }: ExportModalProps) {
  const [selectedQuality, setSelectedQuality] = useState('high');
  const [isExporting, setIsExporting] = useState(false);
  const [exportStage, setExportStage] = useState('');
  const [exportProgress, setExportProgress] = useState(0);

  const handleExport = useCallback(async () => {
    const quality = QUALITY_PRESETS.find((q) => q.key === selectedQuality) || QUALITY_PRESETS[1];

    setIsExporting(true);
    setExportProgress(0);

    try {
      const { setIsPlaying } = useTimelineStore.getState();
      setIsPlaying(false);

      const { clips, tracks, trackOrder } = useTimelineStore.getState();
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

      const width = settings.width;
      const height = settings.height;
      const frameRate = settings.frameRate;
      const totalFrames = Math.ceil(totalDuration * frameRate);

      if (totalFrames === 0) {
        setExportStage('Timeline is empty');
        setIsExporting(false);
        return;
      }

      setExportStage('Initializing encoder...');

      // Import webm-muxer dynamically
      const { Muxer, ArrayBufferTarget } = await import('webm-muxer');

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: 'V_VP9',
          width,
          height,
          frameRate,
        },
        firstTimestampBehavior: 'offset',
      });

      // Set up VideoEncoder with frame-level timestamp control
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta ?? undefined);
        },
        error: (e) => {
          console.error('VideoEncoder error:', e);
        },
      });

      encoder.configure({
        codec: 'vp09.00.10.08',
        width,
        height,
        bitrate: quality.bps,
        framerate: frameRate,
      });

      // Create canvas for rendering
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      const frameDurationMicros = Math.round(1_000_000 / frameRate);

      // Render and encode each frame with precise timestamps
      for (let i = 0; i < totalFrames; i++) {
        const time = i / frameRate;

        setExportStage(`Rendering frame ${i + 1}/${totalFrames}`);
        setExportProgress(Math.round((i / totalFrames) * 90));

        // Seek active videos to the correct time
        for (const clipObj of Object.values(clips)) {
          if (clipObj.transitionData || clipObj.textData) continue;
          const el = elements[clipObj.assetId];
          if (!(el instanceof HTMLVideoElement)) continue;
          if (time >= clipObj.startTime && time < clipObj.startTime + clipObj.duration) {
            const internalTime = clipObj.inPoint + ((time - clipObj.startTime) * clipObj.speed);
            if (Math.abs(el.currentTime - internalTime) > 0.02) {
              el.currentTime = internalTime;
              await new Promise<void>((r) => {
                const done = () => { el.removeEventListener('seeked', done); r(); };
                el.addEventListener('seeked', done);
                setTimeout(done, 500);
              });
            }
          }
        }

        // Render the composited frame
        renderFrameToCanvasExport(
          ctx, width, height, width, height,
          settings.backgroundColor, time,
          clips, tracks, trackOrder,
          elements as Record<string, HTMLVideoElement | HTMLImageElement>,
        );

        // Create VideoFrame with precise timestamp
        const frame = new VideoFrame(canvas, {
          timestamp: i * frameDurationMicros,
          duration: frameDurationMicros,
        });

        // Encode — keyframe every 2 seconds
        const isKeyFrame = i % (frameRate * 2) === 0;
        encoder.encode(frame, { keyFrame: isKeyFrame });
        frame.close();

        // Back-pressure: wait if encoder queue is getting large
        if (encoder.encodeQueueSize > 5) {
          await new Promise<void>((r) => {
            const check = () => {
              if (encoder.encodeQueueSize <= 2) r();
              else setTimeout(check, 10);
            };
            check();
          });
        }

        // Yield every 3 frames for UI responsiveness
        if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      // Flush encoder and finalize
      setExportStage('Encoding...');
      setExportProgress(92);
      await encoder.flush();
      encoder.close();

      muxer.finalize();

      const videoBuffer = target.buffer;
      if (!videoBuffer || videoBuffer.byteLength === 0) {
        throw new Error('Export produced an empty file.');
      }

      // Download
      setExportStage('Downloading...');
      setExportProgress(98);

      const blob = new Blob([videoBuffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${settings.name || 'export'}.webm`;
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
  }, [selectedQuality, onClose]);

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
  const qualityLabel = QUALITY_PRESETS.find((q) => q.key === selectedQuality)?.bps;

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
          {/* Output info */}
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
              Bitrate: {qualityLabel ? `${qualityLabel / 1_000_000}Mbps` : ''}
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
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
