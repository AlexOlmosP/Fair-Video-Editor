'use client';

import React, { useState, useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { isTTSSupported, getAvailableVoices, previewTTS, estimateDuration, stopTTS } from '@/engine/processors/TextToSpeech';

export function TTSPanel() {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTTSSupported()) return;

    const loadVoices = () => {
      const available = getAvailableVoices();
      setVoices(available);
      if (available.length > 0 && !selectedVoice) {
        setSelectedVoice(available[0].name);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, [selectedVoice]);

  const handlePreview = async () => {
    if (!text.trim()) return;
    setError(null);
    setIsPreviewing(true);
    try {
      await previewTTS({ text, voice: selectedVoice, rate, pitch });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleStop = () => {
    stopTTS();
    setIsPreviewing(false);
  };

  const handleAddToTimeline = () => {
    if (!text.trim()) return;

    const duration = estimateDuration(text, rate);
    const { addTrack, addClip, trackOrder, tracks } = useTimelineStore.getState();

    // Find or create an audio track
    let audioTrackId = trackOrder.find((id) => tracks[id]?.type === 'audio');
    if (!audioTrackId) {
      audioTrackId = addTrack('audio', 'TTS Audio');
    }

    addClip({
      assetId: '',
      trackId: audioTrackId,
      startTime: useTimelineStore.getState().playheadTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      speed: 1,
      opacity: 1,
      volume: 1,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      filters: [],
      keyframes: [],
      blendMode: 'normal',
      locked: false,
      visible: true,
      ttsData: {
        text,
        voice: selectedVoice,
        lang: voices.find((v) => v.name === selectedVoice)?.lang || 'en-US',
        rate,
        pitch,
      },
    });
  };

  if (!isTTSSupported()) {
    return (
      <div className="flex flex-col h-full p-3">
        <h2 className="text-sm font-semibold text-zinc-300 mb-2">Text-to-Speech</h2>
        <p className="text-red-400 text-xs">TTS is not supported in this browser.</p>
      </div>
    );
  }

  // Group voices by language
  const langGroups = new Map<string, SpeechSynthesisVoice[]>();
  for (const v of voices) {
    const lang = v.lang.split('-')[0];
    if (!langGroups.has(lang)) langGroups.set(lang, []);
    langGroups.get(lang)!.push(v);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Text-to-Speech</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to convert to speech..."
          className="w-full h-24 bg-zinc-800 text-zinc-200 text-sm px-3 py-2 rounded border border-zinc-700 focus:border-blue-500 outline-none resize-none"
        />

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Voice</label>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="w-full bg-zinc-800 text-zinc-200 text-sm px-2 py-1.5 rounded border border-zinc-700 outline-none"
          >
            {Array.from(langGroups.entries()).map(([lang, langVoices]) => (
              <optgroup key={lang} label={lang.toUpperCase()}>
                {langVoices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Rate: {rate.toFixed(1)}</label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Pitch: {pitch.toFixed(1)}</label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {text.trim() && (
          <p className="text-zinc-600 text-[10px]">
            Est. duration: {estimateDuration(text, rate).toFixed(1)}s
          </p>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={isPreviewing ? handleStop : handlePreview}
            disabled={!text.trim()}
            className="flex-1 px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {isPreviewing ? 'Stop' : 'Preview'}
          </button>
          <button
            onClick={handleAddToTimeline}
            disabled={!text.trim()}
            className="flex-1 px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors font-medium"
          >
            Add to Timeline
          </button>
        </div>
      </div>
    </div>
  );
}
