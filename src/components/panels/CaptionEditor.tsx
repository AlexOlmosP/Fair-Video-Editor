'use client';

import React, { useState, useCallback } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useMediaStore } from '@/store/useMediaStore';
import { isSpeechRecognitionSupported, generateCaptions } from '@/engine/processors/AutoCaptionGenerator';
import type { CaptionEntry } from '@/store/types';
import { v4 as uuid } from 'uuid';

export function CaptionEditor() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [captions, setCaptions] = useState<CaptionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setError(null);

    if (!isSpeechRecognitionSupported()) {
      setError('Speech recognition requires Chrome or Edge browser.');
      return;
    }

    // Find the first selected video clip or the first video clip on the timeline
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
      // Play the video for speech recognition to work
      element.currentTime = clip.inPoint;
      await element.play();

      const entries = await generateCaptions(element, (progress) => {
        setCaptions([...progress]);
      });

      setCaptions(entries);

      // Stop video playback
      element.pause();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Caption generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleAddToTimeline = useCallback(() => {
    if (captions.length === 0) return;

    const { addTrack, addClip } = useTimelineStore.getState();

    // Create a caption track
    const trackId = addTrack('caption', 'Captions');

    // Add each caption as a text clip
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

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Auto Captions</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {isGenerating ? 'Generating...' : 'Generate Captions'}
        </button>

        {error && (
          <p className="text-red-400 text-xs">{error}</p>
        )}

        {isGenerating && (
          <p className="text-zinc-500 text-xs">Playing video for speech recognition... Make sure your audio is working.</p>
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
                <div key={caption.id} className="bg-zinc-800 rounded p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {caption.startTime.toFixed(1)}s - {caption.endTime.toFixed(1)}s
                    </span>
                    <button
                      onClick={() => removeCaption(caption.id)}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
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
                    className="w-full bg-zinc-900 text-zinc-200 text-sm px-2 py-1 rounded border border-zinc-700 focus:border-blue-500 outline-none"
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
