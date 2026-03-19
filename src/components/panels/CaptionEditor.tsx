'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { transcribeVideo, isWhisperSupported, type TranscriptionStatus, type TranscriptionSegment } from '@/engine/processors/WhisperTranscriber';
import { generateId } from '@/lib/id';

interface CaptionItem {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
}

export function CaptionEditor() {
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef(false);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setCaptions([]);
    abortRef.current = false;

    if (!isWhisperSupported()) {
      setError('Your browser does not support the required audio APIs.');
      return;
    }

    // Find a video clip to transcribe
    const { clips, selectedClipIds } = useTimelineStore.getState();
    const { assets } = useProjectStore.getState();
    const { elements } = useMediaStore.getState();

    let targetClipId = selectedClipIds[0];
    if (!targetClipId) {
      const firstVideoClip = Object.values(clips).find((c) => {
        const asset = assets[c.assetId];
        return asset?.type === 'video';
      });
      if (firstVideoClip) targetClipId = firstVideoClip.id;
    }

    if (!targetClipId) {
      setError('No video clip found. Import a video first.');
      return;
    }

    const clip = clips[targetClipId];
    const element = elements[clip?.assetId];
    if (!(element instanceof HTMLVideoElement)) {
      setError('Selected clip is not a video.');
      return;
    }

    setIsGenerating(true);

    try {
      const segments = await transcribeVideo(element, (s) => {
        if (abortRef.current) return;
        setStatus(s);
      });

      if (!abortRef.current) {
        // Convert segments to caption items with clip timeline offset
        const clipOffset = clip.startTime;
        const items: CaptionItem[] = segments.map((seg: TranscriptionSegment) => ({
          id: generateId(),
          text: seg.text,
          startTime: seg.startTime + clipOffset,
          endTime: seg.endTime + clipOffset,
        }));
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

    const { addTrack, addClip } = useTimelineStore.getState();
    const { settings } = useProjectStore.getState();
    const trackId = addTrack('caption', 'Captions');

    for (const caption of captions) {
      const duration = Math.max(0.3, caption.endTime - caption.startTime);
      addClip({
        assetId: '',
        trackId,
        startTime: caption.startTime,
        duration,
        inPoint: 0,
        outPoint: duration,
        speed: 1,
        opacity: 1,
        volume: 0,
        position: { x: 0, y: settings.height * 0.35 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        filters: [],
        keyframes: [],
        blendMode: 'normal',
        locked: false,
        visible: true,
        textData: {
          text: caption.text,
          fontFamily: 'system-ui',
          fontSize: 48,
          color: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.6)',
          strokeColor: '#000000',
          strokeWidth: 2,
        },
      });
    }
  }, [captions]);

  const updateCaption = (id: string, updates: Partial<CaptionItem>) => {
    setCaptions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const removeCaption = (id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
  };

  // Progress display helpers
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
      case 'loading-model': return status.progress * 0.3; // 0-30%
      case 'extracting-audio': return 35;
      case 'transcribing': return 40 + status.progress * 0.6; // 40-100%
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
          <p>Generates captions from video audio using AI speech recognition. Processes the actual audio track — no microphone needed.</p>
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
