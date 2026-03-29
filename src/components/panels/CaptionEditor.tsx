'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { transcribeVideo, isWhisperSupported, type TranscriptionStatus, type TranscriptionSegment } from '@/engine/processors/WhisperTranscriber';
import { generateId } from '@/lib/id';

const FONT_OPTIONS = [
  'system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman',
  'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Palatino', 'Garamond', 'Tahoma', 'Lucida Console',
  'Segoe UI', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins',
];

const MAX_WORDS_PER_CAPTION = 3;

interface CaptionItem {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
}

/**
 * Split segments into chunks of max N words each, distributing time evenly.
 */
function splitIntoWordChunks(segments: TranscriptionSegment[], maxWords: number): CaptionItem[] {
  const items: CaptionItem[] = [];

  for (const seg of segments) {
    const text = seg.text?.trim();
    if (!text) continue;

    const words = text.split(/\s+/);
    if (words.length <= maxWords) {
      items.push({
        id: generateId(),
        text,
        startTime: seg.startTime,
        endTime: seg.endTime,
      });
      continue;
    }

    // Split into chunks of maxWords
    const totalDuration = seg.endTime - seg.startTime;
    const chunkCount = Math.ceil(words.length / maxWords);
    const chunkDuration = totalDuration / chunkCount;

    for (let i = 0; i < chunkCount; i++) {
      const chunkWords = words.slice(i * maxWords, (i + 1) * maxWords);
      items.push({
        id: generateId(),
        text: chunkWords.join(' '),
        startTime: seg.startTime + i * chunkDuration,
        endTime: seg.startTime + (i + 1) * chunkDuration,
      });
    }
  }

  return items;
}

export function CaptionEditor() {
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [captionFont, setCaptionFont] = useState('system-ui');
  const abortRef = useRef(false);
  const sourceClipRef = useRef<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setCaptions([]);
    abortRef.current = false;

    if (!isWhisperSupported()) {
      setError('Your browser does not support the required audio APIs.');
      return;
    }

    const { clips, selectedClipIds } = useTimelineStore.getState();
    const { assets } = useProjectStore.getState();
    const { elements } = useMediaStore.getState();

    let targetClipId = selectedClipIds[0];
    if (!targetClipId) {
      const firstMediaClip = Object.values(clips).find((c) => {
        const asset = assets[c.assetId];
        return asset?.type === 'video' || asset?.type === 'audio';
      });
      if (firstMediaClip) targetClipId = firstMediaClip.id;
    }

    if (!targetClipId) {
      setError('No video or audio clip found. Import a media file first.');
      return;
    }

    const clip = clips[targetClipId];
    const element = elements[clip?.assetId];
    if (!(element instanceof HTMLVideoElement) && !(element instanceof HTMLAudioElement)) {
      setError('Selected clip is not a video or audio file.');
      return;
    }

    sourceClipRef.current = targetClipId;
    setIsGenerating(true);

    try {
      const segments = await transcribeVideo(element, (s) => {
        if (abortRef.current) return;
        setStatus(s);
      });

      if (!abortRef.current) {
        const clipOffset = clip.startTime;
        const offsetSegments = segments.map((seg: TranscriptionSegment) => ({
          ...seg,
          startTime: seg.startTime + clipOffset,
          endTime: seg.endTime + clipOffset,
        }));
        const items = splitIntoWordChunks(offsetSegments, MAX_WORDS_PER_CAPTION);
        setCaptions(items);
      }
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err.message : 'Transcription failed');
      }
    } finally {
      setIsGenerating(false);
      setStatus(null);
    }
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    setIsGenerating(false);
    setStatus(null);
  }, []);

  const handleAddToTimeline = useCallback(() => {
    if (captions.length === 0) return;

    try {
      const { addTrack, addClip, clips } = useTimelineStore.getState();
      const { settings } = useProjectStore.getState();

      // Find the source clip's track to place captions right below it
      const sourceClip = sourceClipRef.current ? clips[sourceClipRef.current] : null;
      const sourceTrackId = sourceClip?.trackId;

      // Create caption track — it will be added after existing tracks
      const trackId = addTrack('caption', 'Captions');

      // Position captions at 3/4 height (y is relative to center, so 0.25*height below center)
      const captionY = Math.round(settings.height * 0.25);

      for (const caption of captions) {
        const start = Number.isFinite(caption.startTime) ? caption.startTime : 0;
        const end = Number.isFinite(caption.endTime) ? caption.endTime : start + 2;
        const duration = Math.max(0.3, end - start);
        const text = caption.text?.trim();
        if (!text) continue;

        addClip({
          assetId: '',
          trackId,
          startTime: start,
          duration,
          inPoint: 0,
          outPoint: duration,
          speed: 1,
          opacity: 1,
          volume: 0,
          position: { x: 0, y: captionY },
          scale: { x: 1, y: 1 },
          rotation: 0,
          filters: [],
          keyframes: [],
          blendMode: 'normal',
          locked: false,
          visible: true,
          textData: {
            text,
            fontFamily: captionFont,
            fontSize: 48,
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.6)',
            strokeColor: '#000000',
            strokeWidth: 2,
          },
        });
      }

      // Reorder: move caption track right after the source video track
      if (sourceTrackId) {
        const { trackOrder } = useTimelineStore.getState();
        const srcIdx = trackOrder.indexOf(sourceTrackId);
        const capIdx = trackOrder.indexOf(trackId);
        if (srcIdx >= 0 && capIdx >= 0 && capIdx !== srcIdx + 1) {
          const newOrder = trackOrder.filter((id) => id !== trackId);
          newOrder.splice(srcIdx + 1, 0, trackId);
          useTimelineStore.setState({ trackOrder: newOrder });
        }
      }
    } catch (err) {
      console.error('Failed to add captions to timeline:', err);
      setError(err instanceof Error ? err.message : 'Failed to add captions to timeline');
    }
  }, [captions, captionFont]);

  const updateCaption = (id: string, updates: Partial<CaptionItem>) => {
    setCaptions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const removeCaption = (id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
  };

  const getProgressLabel = () => {
    if (!status) return '';
    switch (status.phase) {
      case 'loading-model':
        return `Downloading AI model... ${Math.round(status.progress)}%`;
      case 'extracting-audio':
        return 'Extracting audio from video...';
      case 'transcribing':
        return `Transcribing audio... ${Math.round(status.progress)}%`;
      case 'error':
        return status.message;
      default:
        return '';
    }
  };

  const getProgressPercent = () => {
    if (!status) return 0;
    switch (status.phase) {
      case 'loading-model': return status.progress * 0.3;
      case 'extracting-audio': return 35;
      case 'transcribing': return 40 + status.progress * 0.6;
      default: return 0;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Auto Captions</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Info notice */}
        <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-xl p-2.5 leading-relaxed">
          <p>Generates captions from video audio using AI. Max {MAX_WORDS_PER_CAPTION} words per line.</p>
          <p className="mt-1 text-[9px] opacity-70">First use downloads a ~40MB AI model (cached for future use).</p>
        </div>

        {/* Generate / Stop buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex-1 px-3 py-2 text-sm rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed btn-press transition-colors font-medium"
          >
            {isGenerating ? 'Processing...' : 'Generate Captions'}
          </button>
          {isGenerating && (
            <button
              onClick={handleStop}
              className="px-3 py-2 text-sm rounded-xl bg-red-600 hover:bg-red-500 btn-press transition-colors font-medium"
            >
              Stop
            </button>
          )}
        </div>

        {/* Progress indicator */}
        {isGenerating && status && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>{getProgressLabel()}</span>
            </div>
            <div className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${getProgressPercent()}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs bg-red-500/10 rounded-xl p-2.5">{error}</p>
        )}

        {captions.length > 0 && (
          <>
            {/* Font selector */}
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1 font-medium">Caption Font</label>
              <select
                value={captionFont}
                onChange={(e) => setCaptionFont(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>
              {/* Font preview */}
              <div
                className="mt-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-center text-[var(--text-primary)] text-sm"
                style={{ fontFamily: captionFont }}
              >
                Caption preview
              </div>
            </div>

            <button
              onClick={handleAddToTimeline}
              className="w-full px-3 py-1.5 text-sm rounded-xl bg-green-700 hover:bg-green-600 btn-press transition-colors font-medium"
            >
              Add to Timeline ({captions.length} captions)
            </button>

            <div className="space-y-2">
              {captions.map((caption) => (
                <div key={caption.id} className="bg-[var(--bg-tertiary)] rounded-xl p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      {caption.startTime.toFixed(1)}s - {caption.endTime.toFixed(1)}s
                    </span>
                    <button
                      onClick={() => removeCaption(caption.id)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors btn-icon-press"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={caption.text}
                    onChange={(e) => updateCaption(caption.id, { text: e.target.value })}
                    className="w-full bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm px-2 py-1 rounded-lg border border-[var(--border-color)] focus:border-blue-500 outline-none"
                    style={{ fontFamily: captionFont }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
