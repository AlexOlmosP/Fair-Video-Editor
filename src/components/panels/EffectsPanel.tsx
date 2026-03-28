'use client';

import React from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import type { ColorCorrectionParams } from '@/store/types';
import { DEFAULT_COLOR_CORRECTION } from '@/store/types';

// ─── Filter effects (toggle on/off as filter strings) ─────────────────────

interface EffectDef {
  id: string;
  label: string;
  category: string;
}

const EFFECTS: EffectDef[] = [
  // Filters (binary on/off; blur/sharpen/invert are not CC-adjustable)
  { id: 'blur',    label: 'Blur',    category: 'Filters' },
  { id: 'sharpen', label: 'Sharpen', category: 'Filters' },
  { id: 'invert',  label: 'Invert',  category: 'Filters' },
  // Keying
  { id: 'chroma-green', label: 'Chroma Key (Green)', category: 'Keying' },
  { id: 'chroma-blue',  label: 'Chroma Key (Blue)',  category: 'Keying' },
  // AI
  { id: 'bg-remove', label: 'Background Remove', category: 'AI' },
];

const FILTER_CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];

// ─── Color Looks (preset colorCorrection values) ───────────────────────────

interface ColorLook {
  id: string;
  label: string;
  description: string;
  correction: Partial<Omit<ColorCorrectionParams, 'hsl'>>;
}

const COLOR_LOOKS: ColorLook[] = [
  { id: 'vivid',     label: 'Vivid',     description: 'Boosted saturation & contrast', correction: { saturation: 40, contrast: 15 } },
  { id: 'warm',      label: 'Warm',      description: 'Golden hour feel',              correction: { temperature: 35, tint: 5 } },
  { id: 'cool',      label: 'Cool',      description: 'Clean blue-toned look',         correction: { temperature: -35 } },
  { id: 'matte',     label: 'Matte',     description: 'Faded film look',               correction: { contrast: -25, saturation: -20, brightness: 10 } },
  { id: 'bw',        label: 'B&W',       description: 'Black & white',                 correction: { saturation: -100 } },
  { id: 'sepia',     label: 'Sepia',     description: 'Vintage warm tone',             correction: { saturation: -40, temperature: 45 } },
];

export function EffectsPanel() {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);

  const selectedClip = selectedClipIds.length === 1 ? clips[selectedClipIds[0]] : null;
  const appliedFilters = selectedClip?.filters ?? [];

  const toggleFilter = (effectId: string) => {
    if (!selectedClip) return;
    const current = selectedClip.filters;
    const updated = current.includes(effectId)
      ? current.filter((f) => f !== effectId)
      : [...current, effectId];
    useTimelineStore.getState().updateClip(selectedClip.id, { filters: updated });
  };

  const isLookActive = (look: ColorLook): boolean => {
    const cc = selectedClip?.colorCorrection;
    if (!cc) return false;
    return (Object.entries(look.correction) as [keyof typeof look.correction, number][])
      .every(([k, v]) => cc[k] === v);
  };

  const applyLook = (look: ColorLook) => {
    if (!selectedClip) return;
    const cc = selectedClip.colorCorrection ?? DEFAULT_COLOR_CORRECTION;
    const active = isLookActive(look);
    const patch: Partial<Omit<ColorCorrectionParams, 'hsl'>> = {};
    for (const [k, v] of Object.entries(look.correction) as [keyof typeof look.correction, number][]) {
      patch[k] = active ? 0 : v;
    }
    useTimelineStore.getState().updateClip(selectedClip.id, {
      colorCorrection: { ...cc, ...patch },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Effects</h2>
        {!selectedClip && (
          <p className="text-[11px] text-[var(--text-muted)] mt-1">Select a clip to apply effects</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">

        {/* Color Looks — apply preset colorCorrection values */}
        <div>
          <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2 px-1">
            Color Looks
          </h3>
          <p className="text-[10px] text-[var(--text-muted)] px-1 mb-2">
            Quick-apply presets — sets Basic sliders in Properties panel
          </p>
          <div className="space-y-1">
            {COLOR_LOOKS.map((look) => {
              const active = isLookActive(look);
              return (
                <button
                  key={look.id}
                  onClick={() => applyLook(look)}
                  disabled={!selectedClip}
                  className={`w-full px-3 py-2 text-sm rounded-xl text-left flex items-center justify-between btn-press transition-colors ${
                    active
                      ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300'
                      : selectedClip
                        ? 'bg-[var(--hover-bg)] border border-transparent hover:border-[var(--accent)]/30 text-[var(--text-secondary)]'
                        : 'bg-[var(--hover-bg)]/50 border border-transparent text-[var(--text-muted)] cursor-not-allowed'
                  }`}
                >
                  <div>
                    <span className="font-medium">{look.label}</span>
                    <span className="ml-2 text-[10px] text-[var(--text-muted)]">{look.description}</span>
                  </div>
                  {active && (
                    <svg className="w-4 h-4 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Binary filter effects */}
        {FILTER_CATEGORIES.map((category) => (
          <div key={category}>
            <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2 px-1">
              {category}
            </h3>
            <div className="space-y-1">
              {EFFECTS.filter((e) => e.category === category).map((effect) => {
                const isApplied = appliedFilters.includes(effect.id);
                return (
                  <button
                    key={effect.id}
                    onClick={() => toggleFilter(effect.id)}
                    disabled={!selectedClip}
                    className={`w-full px-3 py-2 text-sm rounded-xl text-left flex items-center justify-between btn-press transition-colors ${
                      isApplied
                        ? 'bg-blue-600/20 border border-blue-500/50 text-blue-300'
                        : selectedClip
                          ? 'bg-[var(--hover-bg)] border border-transparent hover:border-[var(--accent)]/30 text-[var(--text-secondary)]'
                          : 'bg-[var(--hover-bg)]/50 border border-transparent text-[var(--text-muted)] cursor-not-allowed'
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
