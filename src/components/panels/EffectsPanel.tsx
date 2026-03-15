'use client';

import React from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';

interface EffectDef {
  id: string;
  label: string;
  category: string;
}

const EFFECTS: EffectDef[] = [
  // Filters
  { id: 'brightness', label: 'Brightness', category: 'Filters' },
  { id: 'contrast', label: 'Contrast', category: 'Filters' },
  { id: 'saturate', label: 'Saturation', category: 'Filters' },
  { id: 'blur', label: 'Blur', category: 'Filters' },
  { id: 'sharpen', label: 'Sharpen', category: 'Filters' },
  // Color
  { id: 'grayscale', label: 'Grayscale', category: 'Color' },
  { id: 'sepia', label: 'Sepia', category: 'Color' },
  { id: 'invert', label: 'Invert', category: 'Color' },
  { id: 'hue-rotate', label: 'Hue Rotate', category: 'Color' },
  // Keying
  { id: 'chroma-green', label: 'Chroma Key (Green)', category: 'Keying' },
  { id: 'chroma-blue', label: 'Chroma Key (Blue)', category: 'Keying' },
  // AI
  { id: 'bg-remove', label: 'Background Remove', category: 'AI' },
];

const categories = [...new Set(EFFECTS.map((e) => e.category))];

export function EffectsPanel() {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);

  const selectedClip = selectedClipIds.length === 1 ? clips[selectedClipIds[0]] : null;
  const appliedFilters = selectedClip?.filters ?? [];

  const toggleEffect = (effectId: string) => {
    if (!selectedClip) return;
    const current = selectedClip.filters;
    const updated = current.includes(effectId)
      ? current.filter((f) => f !== effectId)
      : [...current, effectId];
    useTimelineStore.getState().updateClip(selectedClip.id, { filters: updated });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300">Effects</h2>
        {!selectedClip && (
          <p className="text-[11px] text-zinc-500 mt-1">Select a clip to apply effects</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {categories.map((category) => (
          <div key={category}>
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 px-1">
              {category}
            </h3>
            <div className="space-y-1">
              {EFFECTS.filter((e) => e.category === category).map((effect) => {
                const isApplied = appliedFilters.includes(effect.id);
                return (
                  <button
                    key={effect.id}
                    onClick={() => toggleEffect(effect.id)}
                    disabled={!selectedClip}
                    className={`w-full px-3 py-2 text-sm rounded text-left flex items-center justify-between transition-colors ${
                      isApplied
                        ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300'
                        : selectedClip
                          ? 'bg-zinc-800 border border-transparent hover:border-zinc-600 text-zinc-300'
                          : 'bg-zinc-800/50 border border-transparent text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    <span>{effect.label}</span>
                    {isApplied && (
                      <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
