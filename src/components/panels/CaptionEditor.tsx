'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { isSpeechRecognitionSupported, generateCaptions } from '@/engine/processors/AutoCaptionGenerator';
import type { CaptionEntry } from '@/store/types';

export function CaptionEditor() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [captions, setCaptions] = useState<CaptionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setElapsedTime(0);

    if (!isSpeechRecognitionSupported()) {
      setError('Speech recognition requires Chrome or Edge browser. Safari and Firefox are not supported.');
      return;
    }

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

    // Start elapsed timer
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      element.currentTime = clip.inPoint;
      element.volume = 1;
      await element.play();

      const { entries, stop } = generateCaptions(element, (progress) => {
        setCaptions([...progress]);
      });

      stopRef.current = stop;
      const result = await entries;
      setCaptions(result);
      element.pause();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Caption generation failed');
    } finally {
      setIsGenerating(false);
      stopRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const handleStop = useCallback(() => {
    stopRef.current?.();
  }, []);

  const handleAddToTimeline = useCallback(() => {
    if (captions.length === 0) return;

    const { addTrack, addClip } = useTimelineStore.getState();
    const trackId = addTrack('caption', 'Captions');

    for (const caption of captions) {
      addClip({
        assetId: '',
        trackId,
        startTime: caption.startTime,
        duration: caption.endTime - caption.startTime,
        inPoint: 0,
        outPoint: caption.endTime - caption.startTime,
        speed: 1,
        opacity: 1,
        volume: 0,
        position: { x: 0, y: 0 },
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

  const updateCaption = (id: string, updates: Partial<CaptionEntry>) => {
    setCaptions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const removeCaption = (id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
  };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Auto Captions</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Info notice */}
        <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded-md p-2.5 leading-relaxed">
          <p className="font-medium mb-1">How it works:</p>
          <p>Captions use your browser&apos;s speech recognition. The video will play through your speakers and the browser listens via your <strong>microphone</strong>.</p>
          <p className="mt-1">For best results: turn up volume, reduce background noise, and use Chrome or Edge.</p>
        </div>

        {/* Generate / Stop buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex-1 px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isGenerating ? 'Listening...' : 'Generate Captions'}
          </button>
          {isGenerating && (
            <button
              onClick={handleStop}
              className="px-3 py-2 text-sm rounded bg-red-600 hover:bg-red-500 transition-colors font-medium"
            >
              Stop
            </button>
          )}
        </div>

        {/* Progress indicator */}
        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>Recording... {formatElapsed(elapsedTime)}</span>
            <span className="ml-auto">{captions.length} captions</span>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-xs bg-red-500/10 rounded p-2">{error}</p>
        )}

        {captions.length > 0 && (
          <>
            <button
              onClick={handleAddToTimeline}
              className="w-full px-3 py-1.5 text-sm rounded bg-green-700 hover:bg-green-600 transition-colors font-medium"
            >
              Add to Timeline ({captions.length} captions)
            </button>

            <div className="space-y-2">
              {captions.map((caption) => (
                <div key={caption.id} className="bg-[var(--bg-tertiary)] rounded p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      {caption.startTime.toFixed(1)}s - {caption.endTime.toFixed(1)}s
                    </span>
                    <button
                      onClick={() => removeCaption(caption.id)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
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
                    className="w-full bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm px-2 py-1 rounded border border-[var(--border-color)] focus:border-blue-500 outline-none"
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
