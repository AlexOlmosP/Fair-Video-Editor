'use client';

import React, { useState, useCallback } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { secondsToDisplay } from '@/lib/time';
import { KeyframeToggle, KeyframeStrip } from './KeyframeEditor';
import { ANIMATION_PRESETS } from '@/engine/animation/presets';
import { SpeedCurveEditor } from './SpeedCurveEditor';
import type { ColorCorrectionParams, HslChannelAdjustment } from '@/store/types';
import { DEFAULT_COLOR_CORRECTION } from '@/store/types';

const FONT_OPTIONS = [
  'system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman',
  'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Palatino', 'Garamond', 'Bookman', 'Tahoma', 'Lucida Console',
  'Segoe UI', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins',
];

const PIP_PRESETS = [
  { label: 'TL', x: -0.3, y: -0.3, scale: 0.3 },
  { label: 'TR', x: 0.3, y: -0.3, scale: 0.3 },
  { label: 'BL', x: -0.3, y: 0.3, scale: 0.3 },
  { label: 'BR', x: 0.3, y: 0.3, scale: 0.3 },
  { label: 'Center', x: 0, y: 0, scale: 1 },
] as const;

// ─── Crop/Main constants ───────────────────────────────────────────────────

const DEFAULT_CROP = { top: 0, right: 0, bottom: 0, left: 0 };

// ─── Color Correction Panel ───────────────────────────────────────────────

const HSL_CHANNELS_UI: { key: keyof ColorCorrectionParams['hsl']; label: string; color: string }[] = [
  { key: 'red',     label: 'R',  color: '#ef4444' },
  { key: 'orange',  label: 'Or', color: '#f97316' },
  { key: 'yellow',  label: 'Y',  color: '#eab308' },
  { key: 'green',   label: 'G',  color: '#22c55e' },
  { key: 'cyan',    label: 'Cy', color: '#06b6d4' },
  { key: 'blue',    label: 'B',  color: '#3b82f6' },
  { key: 'purple',  label: 'Pu', color: '#a855f7' },
  { key: 'magenta', label: 'Mg', color: '#ec4899' },
];

function ccFmt(v: number) {
  return (v > 0 ? '+' : '') + Math.round(v);
}

/** Compact −100 to +100 slider for color correction */
function CCSlider({
  label, value, onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
        <span className={`font-mono text-[10px] tabular-nums w-8 text-right ${value !== 0 ? 'text-blue-400' : 'text-[var(--text-muted)]'}`}>
          {ccFmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full h-1 bg-[var(--hover-bg)] rounded appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
}

function ColorCorrectionPanel({
  cc, updateCC, updateHsl, resetCC,
  activeHslChannel, setActiveHslChannel,
  showHsl, setShowHsl,
}: {
  cc: ColorCorrectionParams;
  updateCC: (key: keyof Omit<ColorCorrectionParams, 'hsl'>, val: number) => void;
  updateHsl: (ch: keyof ColorCorrectionParams['hsl'], key: keyof HslChannelAdjustment, val: number) => void;
  resetCC: () => void;
  activeHslChannel: keyof ColorCorrectionParams['hsl'];
  setActiveHslChannel: (ch: keyof ColorCorrectionParams['hsl']) => void;
  showHsl: boolean;
  setShowHsl: (v: boolean) => void;
}) {
  const allBasicDefault = (['brightness', 'contrast', 'saturation', 'temperature', 'tint'] as const)
    .every((k) => cc[k] === 0);
  const allHslDefault = Object.values(cc.hsl).every(
    (ch) => ch.hue === 0 && ch.saturation === 0 && ch.luminance === 0
  );
  const isAllDefault = allBasicDefault && allHslDefault;
  const chAdj = cc.hsl[activeHslChannel];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
          Color Correction
        </h3>
        {!isAllDefault && (
          <button
            onClick={resetCC}
            className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-900/20"
          >
            Reset
          </button>
        )}
      </div>

      {/* Basic sliders */}
      <div className="space-y-2 mb-3">
        <p className="text-[10px] text-[var(--text-muted)] font-medium tracking-wide">Basic</p>
        {([
          ['brightness', 'Brightness'],
          ['contrast',   'Contrast'],
          ['saturation', 'Saturation'],
          ['temperature','Temperature'],
          ['tint',       'Tint'],
        ] as [keyof Omit<ColorCorrectionParams, 'hsl'>, string][]).map(([key, label]) => (
          <CCSlider
            key={key}
            label={label}
            value={cc[key]}
            onChange={(v) => updateCC(key, v)}
          />
        ))}
      </div>

      {/* HSL sub-panel (collapsible) */}
      <div>
        <button
          onClick={() => setShowHsl(!showHsl)}
          className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] font-medium tracking-wide mb-2 hover:text-[var(--text-secondary)] transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showHsl ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          HSL
          {!allHslDefault && <span className="ml-1 text-blue-400 text-[8px]">●</span>}
        </button>

        {showHsl && (
          <div className="space-y-2">
            {/* Channel selector */}
            <div className="flex gap-1 flex-wrap">
              {HSL_CHANNELS_UI.map(({ key, label, color }) => {
                const ch = cc.hsl[key];
                const hasAdj = ch.hue !== 0 || ch.saturation !== 0 || ch.luminance !== 0;
                const isActive = activeHslChannel === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveHslChannel(key)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors btn-press ${
                      isActive
                        ? 'bg-[var(--accent)]/20 border border-[var(--accent)]/50'
                        : 'bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--accent)]/30'
                    }`}
                    style={{ color: isActive ? color : undefined }}
                  >
                    {hasAdj && !isActive && <span style={{ color }}>● </span>}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Active channel sliders */}
            <CCSlider label="Hue"        value={chAdj.hue}        onChange={(v) => updateHsl(activeHslChannel, 'hue',        v)} />
            <CCSlider label="Saturation" value={chAdj.saturation} onChange={(v) => updateHsl(activeHslChannel, 'saturation', v)} />
            <CCSlider label="Luminance"  value={chAdj.luminance}  onChange={(v) => updateHsl(activeHslChannel, 'luminance',  v)} />
          </div>
        )}
      </div>
    </div>
  );
}

function PropertySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function PropertiesPanel() {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const isCropMode = useTimelineStore((s) => s.isCropMode);
  const setClipKeyframes = useTimelineStore((s) => s.setClipKeyframes);
  const addAnimation = useTimelineStore((s) => s.addAnimation);
  const removeAnimation = useTimelineStore((s) => s.removeAnimation);
  const projectWidth = useProjectStore((s) => s.settings.width);
  const projectHeight = useProjectStore((s) => s.settings.height);
  const posRangeX = Math.round(projectWidth / 2);
  const posRangeY = Math.round(projectHeight / 2);

  // Color Correction panel state
  const [activeHslChannel, setActiveHslChannel] = useState<keyof ColorCorrectionParams['hsl']>('red');
  const [showHsl, setShowHsl] = useState(false);

  // Helper to update a property across all selected clips
  const updateAllSelected = useCallback((updates: Record<string, unknown>) => {
    selectedClipIds.forEach((id) => updateClip(id, updates));
  }, [selectedClipIds, updateClip]);

  if (selectedClipIds.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm p-4 text-center">
          Select a clip to view its properties
        </div>
      </div>
    );
  }

  // ── Multi-clip bulk edit panel ──
  if (selectedClipIds.length > 1) {
    const selectedClips = selectedClipIds.map((id) => clips[id]).filter(Boolean);
    const hasText = selectedClips.some((c) => c.textData);
    const firstClip = selectedClips[0];
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Bulk Edit</h2>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{selectedClipIds.length} clips selected</p>
        </div>
        <div className="p-3 space-y-3 overflow-y-auto text-xs">
          {/* Position */}
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] font-medium mb-1">Position</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[9px] text-[var(--text-muted)]">X</span>
                <input type="range" min={-posRangeX} max={posRangeX} value={firstClip?.position.x ?? 0}
                  onChange={(e) => updateAllSelected({ position: { x: +e.target.value, y: firstClip?.position.y ?? 0 } })}
                  className="w-full" />
              </div>
              <div>
                <span className="text-[9px] text-[var(--text-muted)]">Y</span>
                <input type="range" min={-posRangeY} max={posRangeY} value={firstClip?.position.y ?? 0}
                  onChange={(e) => updateAllSelected({ position: { x: firstClip?.position.x ?? 0, y: +e.target.value } })}
                  className="w-full" />
              </div>
            </div>
          </div>
          {/* Scale */}
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] font-medium mb-1">Scale</label>
            <input type="range" min={0.1} max={3} step={0.05} value={firstClip?.scale.x ?? 1}
              onChange={(e) => updateAllSelected({ scale: { x: +e.target.value, y: +e.target.value } })}
              className="w-full" />
            <span className="text-[10px] text-[var(--text-muted)]">{((firstClip?.scale.x ?? 1) * 100).toFixed(0)}%</span>
          </div>
          {/* Opacity */}
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] font-medium mb-1">Opacity</label>
            <input type="range" min={0} max={1} step={0.05} value={firstClip?.opacity ?? 1}
              onChange={(e) => updateAllSelected({ opacity: +e.target.value })}
              className="w-full" />
            <span className="text-[10px] text-[var(--text-muted)]">{((firstClip?.opacity ?? 1) * 100).toFixed(0)}%</span>
          </div>
          {/* Volume */}
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] font-medium mb-1">Volume</label>
            <input type="range" min={0} max={2} step={0.05} value={firstClip?.volume ?? 1}
              onChange={(e) => updateAllSelected({ volume: +e.target.value })}
              className="w-full" />
            <span className="text-[10px] text-[var(--text-muted)]">{((firstClip?.volume ?? 1) * 100).toFixed(0)}%</span>
          </div>
          {/* Text properties (if any selected clips have text) */}
          {hasText && (
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] font-medium mb-1">Text Font</label>
              <select
                value={firstClip?.textData?.fontFamily ?? 'system-ui'}
                onChange={(e) => {
                  selectedClipIds.forEach((id) => {
                    const c = clips[id];
                    if (c?.textData) {
                      updateClip(id, { textData: { ...c.textData, fontFamily: e.target.value } });
                    }
                  });
                }}
                className="w-full px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)]"
              >
                {['system-ui','Arial','Helvetica','Georgia','Times New Roman','Verdana','Impact','Courier New','Trebuchet MS','Comic Sans MS','Palatino','Garamond','Tahoma','Segoe UI','Roboto','Open Sans','Montserrat','Poppins'].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <label className="block text-[10px] text-[var(--text-muted)] font-medium mt-2 mb-1">Font Size</label>
              <input type="range" min={12} max={200} value={firstClip?.textData?.fontSize ?? 48}
                onChange={(e) => {
                  selectedClipIds.forEach((id) => {
                    const c = clips[id];
                    if (c?.textData) {
                      updateClip(id, { textData: { ...c.textData, fontSize: +e.target.value } });
                    }
                  });
                }}
                className="w-full" />
              <span className="text-[10px] text-[var(--text-muted)]">{firstClip?.textData?.fontSize ?? 48}px</span>
              <label className="block text-[10px] text-[var(--text-muted)] font-medium mt-2 mb-1">Color</label>
              <input type="color" value={firstClip?.textData?.color ?? '#ffffff'}
                onChange={(e) => {
                  selectedClipIds.forEach((id) => {
                    const c = clips[id];
                    if (c?.textData) {
                      updateClip(id, { textData: { ...c.textData, color: e.target.value } });
                    }
                  });
                }}
                className="w-8 h-8 rounded border border-[var(--border-color)] cursor-pointer bg-transparent" />
            </div>
          )}
          {/* Delete all */}
          <button
            onClick={() => selectedClipIds.forEach((id) => useTimelineStore.getState().removeClip(id))}
            className="w-full px-3 py-2 rounded-lg bg-red-600/20 text-red-400 text-xs font-medium hover:bg-red-600/30 btn-press"
          >
            Delete {selectedClipIds.length} clips
          </button>
        </div>
      </div>
    );
  }

  const clip = clips[selectedClipIds[0]];
  if (!clip) return null;

  const activeFilters = clip.filters;
  const clipSourceDuration = clip.outPoint - clip.inPoint;

  // Color Correction helpers — read fresh state to avoid stale closures during rapid slider drags
  const cc = clip.colorCorrection ?? DEFAULT_COLOR_CORRECTION;
  const getFreshCC = () => {
    const freshClip = useTimelineStore.getState().clips[clip.id];
    return freshClip?.colorCorrection ?? DEFAULT_COLOR_CORRECTION;
  };
  const updateCC = (key: keyof Omit<ColorCorrectionParams, 'hsl'>, val: number) => {
    const fresh = getFreshCC();
    updateClip(clip.id, { colorCorrection: { ...fresh, [key]: val } });
  };
  const updateHsl = (
    channel: keyof ColorCorrectionParams['hsl'],
    key: keyof HslChannelAdjustment,
    val: number
  ) => {
    const fresh = getFreshCC();
    updateClip(clip.id, {
      colorCorrection: {
        ...fresh,
        hsl: { ...fresh.hsl, [channel]: { ...fresh.hsl[channel], [key]: val } },
      },
    });
  };
  const resetCC = () => updateClip(clip.id, { colorCorrection: undefined });

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">Properties</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Timing */}
        <PropertySection title="Timing">
          <PropertyRow label="Start" value={secondsToDisplay(clip.startTime)} />
          <PropertyRow label="Duration" value={secondsToDisplay(clip.duration)} />
          <SpeedControl
            value={clip.speed}
            onChange={(v) => updateClip(clip.id, { speed: v })}
          />
        </PropertySection>

        {/* Speed Curve (only for non-text clips) */}
        {!clip.textData && (
          <PropertySection title="Speed Curve">
            <SpeedCurveEditor clip={clip} />
          </PropertySection>
        )}

        {/* Animation Presets */}
        <PropertySection title="Animation Presets">
          <div className="flex gap-1 flex-wrap">
            {ANIMATION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  const dur = clipSourceDuration;
                  const effectLen = Math.min(1, dur * 0.3);
                  let startTime = 0;
                  let endTime = dur;
                  if (preset.id === 'fade-in') {
                    startTime = 0;
                    endTime = effectLen;
                  } else if (preset.id === 'fade-out') {
                    startTime = dur - effectLen;
                    endTime = dur;
                  }
                  addAnimation(clip.id, {
                    presetId: preset.id,
                    presetLabel: preset.label,
                    startTime,
                    endTime,
                  });
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] btn-press transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
          {/* Active animations */}
          {(clip.animations?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              {clip.animations!.map((anim) => (
                <div key={anim.id} className="flex items-center justify-between bg-[var(--bg-tertiary)]/60 rounded px-2 py-1">
                  <span className="text-[10px] text-[var(--text-secondary)]">{anim.presetLabel}</span>
                  <button
                    onClick={() => removeAnimation(clip.id, anim.id)}
                    className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  for (const anim of clip.animations || []) {
                    removeAnimation(clip.id, anim.id);
                  }
                }}
                className="px-2 py-1 rounded-lg text-xs font-medium bg-red-900/40 text-red-400 hover:bg-red-900/60 btn-press transition-colors"
              >
                Clear All
              </button>
            </div>
          )}
        </PropertySection>

        {/* PiP Position Presets */}
        <PropertySection title="Position Presets">
          <div className="flex gap-1 flex-wrap">
            {PIP_PRESETS.map((preset) => {
              const settings = useProjectStore.getState().settings;
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    updateClip(clip.id, {
                      position: { x: preset.x * settings.width, y: preset.y * settings.height },
                      scale: { x: preset.scale, y: preset.scale },
                    });
                  }}
                  className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] btn-press transition-colors"
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </PropertySection>

        {/* Text Properties (only for text clips) */}
        {clip.textData && (
          <PropertySection title="Text">
            <div className="space-y-2">
              <textarea
                value={clip.textData.text}
                onChange={(e) =>
                  updateClip(clip.id, { textData: { ...clip.textData!, text: e.target.value } })
                }
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none"
                rows={2}
                placeholder="Enter text..."
              />
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">Font</label>
                <select
                  value={clip.textData.fontFamily}
                  onChange={(e) =>
                    updateClip(clip.id, { textData: { ...clip.textData!, fontFamily: e.target.value } })
                  }
                  className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Size</label>
                  <input
                    type="number"
                    value={clip.textData.fontSize}
                    onChange={(e) =>
                      updateClip(clip.id, { textData: { ...clip.textData!, fontSize: Math.max(8, parseInt(e.target.value) || 24) } })
                    }
                    className="w-full px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    min={8}
                    max={300}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Color</label>
                  <input
                    type="color"
                    value={clip.textData.color}
                    onChange={(e) =>
                      updateClip(clip.id, { textData: { ...clip.textData!, color: e.target.value } })
                    }
                    className="w-full h-8 rounded-lg border border-[var(--border-color)] cursor-pointer bg-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">Background</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={clip.textData.backgroundColor?.replace(/rgba?\([^)]+\)/, '#000000') || '#000000'}
                    onChange={(e) =>
                      updateClip(clip.id, { textData: { ...clip.textData!, backgroundColor: e.target.value } })
                    }
                    className="w-8 h-8 rounded-lg border border-[var(--border-color)] cursor-pointer bg-transparent"
                  />
                  <button
                    onClick={() =>
                      updateClip(clip.id, { textData: { ...clip.textData!, backgroundColor: clip.textData!.backgroundColor ? undefined : 'rgba(0,0,0,0.6)' } })
                    }
                    className={`px-2 py-1 rounded-lg text-[10px] font-medium btn-press transition-colors ${
                      clip.textData.backgroundColor
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                    }`}
                  >
                    {clip.textData.backgroundColor ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            </div>
          </PropertySection>
        )}

        {/* Transform */}
        <PropertySection title="Transform">
          <KeyframedSlider
            clipId={clip.id}
            property="opacity"
            label="Opacity"
            value={clip.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateClip(clip.id, { opacity: v })}
          />
          <KeyframedSlider
            clipId={clip.id}
            property="rotation"
            label="Rotation"
            value={clip.rotation}
            min={-360}
            max={360}
            step={1}
            onChange={(v) => updateClip(clip.id, { rotation: v })}
            format={(v) => `${v}°`}
          />
          <KeyframedSlider
            clipId={clip.id}
            property="scaleX"
            label="Scale X"
            value={clip.scale.x}
            min={0.05}
            max={5}
            step={0.01}
            onChange={(v) => updateClip(clip.id, { scale: { ...clip.scale, x: v } })}
          />
          <KeyframedSlider
            clipId={clip.id}
            property="scaleY"
            label="Scale Y"
            value={clip.scale.y}
            min={0.05}
            max={5}
            step={0.01}
            onChange={(v) => updateClip(clip.id, { scale: { ...clip.scale, y: v } })}
          />
          <KeyframedSlider
            clipId={clip.id}
            property="positionX"
            label="Position X"
            value={clip.position.x}
            min={-posRangeX}
            max={posRangeX}
            step={1}
            onChange={(v) => updateClip(clip.id, { position: { ...clip.position, x: v } })}
            format={(v) => `${v}px`}
          />
          <KeyframedSlider
            clipId={clip.id}
            property="positionY"
            label="Position Y"
            value={clip.position.y}
            min={-posRangeY}
            max={posRangeY}
            step={1}
            onChange={(v) => updateClip(clip.id, { position: { ...clip.position, y: v } })}
            format={(v) => `${v}px`}
          />
        </PropertySection>

        {/* Audio */}
        <PropertySection title="Audio">
          <PropertySlider
            label="Volume"
            value={clip.volume}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => updateClip(clip.id, { volume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </PropertySection>

        {/* Color Correction */}
        {!clip.textData && !clip.transitionData && (
          <ColorCorrectionPanel
            cc={cc}
            updateCC={updateCC}
            updateHsl={updateHsl}
            resetCC={resetCC}
            activeHslChannel={activeHslChannel}
            setActiveHslChannel={setActiveHslChannel}
            showHsl={showHsl}
            setShowHsl={setShowHsl}
          />
        )}

        {/* Crop */}
        {!clip.textData && !clip.transitionData && (
          <PropertySection title="Crop">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-muted)]">Drag handles on canvas</span>
              <button
                onClick={() => useTimelineStore.getState().setCropMode(!isCropMode)}
                className={`px-2 py-1 rounded-lg text-xs font-medium btn-press transition-colors ${
                  isCropMode
                    ? 'bg-amber-600 text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {isCropMode ? 'Exit Crop' : 'Crop'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <div key={side}>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1 capitalize">{side}</label>
                  <input
                    type="number"
                    min={0}
                    max={95}
                    step={1}
                    value={Math.round(clip.crop?.[side] ?? 0)}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(95, parseFloat(e.target.value) || 0));
                      updateClip(clip.id, { crop: { ...DEFAULT_CROP, ...clip.crop, [side]: v } });
                    }}
                    className="w-full px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              ))}
            </div>
            {clip.crop && (clip.crop.top > 0 || clip.crop.right > 0 || clip.crop.bottom > 0 || clip.crop.left > 0) && (
              <button
                onClick={() => updateClip(clip.id, { crop: DEFAULT_CROP })}
                className="mt-1 w-full px-2 py-1 rounded-lg text-[10px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-red-400 btn-press transition-colors"
              >
                Reset Crop
              </button>
            )}
          </PropertySection>
        )}

        {/* Applied Effects */}
        {activeFilters.length > 0 && (
          <PropertySection title="Applied Effects">
            <div className="space-y-1">
              {activeFilters.map((f) => (
                <div
                  key={f}
                  className="flex items-center justify-between px-2 py-1 rounded bg-[var(--bg-tertiary)] text-sm"
                >
                  <span className="text-[var(--text-secondary)] capitalize">{f.replace('-', ' ')}</span>
                  <button
                    onClick={() => {
                      updateClip(clip.id, {
                        filters: clip.filters.filter((ef) => ef !== f),
                      });
                    }}
                    className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </PropertySection>
        )}
      </div>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="text-[var(--text-primary)] font-mono text-xs">{value}</span>
    </div>
  );
}

function PropertySlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const displayValue = format ? format(value) : value.toFixed(2);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="text-[var(--text-primary)] font-mono text-xs">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-[var(--hover-bg)] rounded appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
}

const SPEED_QUICK_BUTTONS = [0.25, 0.5, 1, 2, 4, 8] as const;

function SpeedControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const toSlider = (speed: number) => Math.log10(speed * 10) / 3;
  const fromSlider = (pos: number) => Math.pow(10, pos * 3) / 10;

  const sliderPos = toSlider(value);
  const displayValue = value < 1 ? value.toFixed(2) : value < 10 ? value.toFixed(1) : Math.round(value).toString();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">Speed</span>
        <span className="text-[var(--text-primary)] font-mono text-xs">{displayValue}x</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={sliderPos}
        onChange={(e) => {
          const raw = fromSlider(parseFloat(e.target.value));
          const rounded = raw < 1 ? Math.round(raw * 20) / 20 : raw < 10 ? Math.round(raw * 4) / 4 : Math.round(raw);
          onChange(Math.max(0.1, Math.min(100, rounded)));
        }}
        className="w-full h-1 bg-[var(--hover-bg)] rounded appearance-none cursor-pointer accent-blue-500"
      />
      <div className="flex gap-1 flex-wrap">
        {SPEED_QUICK_BUTTONS.map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`px-1.5 py-0.5 rounded-lg text-[10px] font-medium btn-press transition-colors ${
              Math.abs(value - s) < 0.01
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

function KeyframedSlider({
  clipId,
  property,
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  clipId: string;
  property: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const displayValue = format ? format(value) : value.toFixed(2);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1">
          <KeyframeToggle clipId={clipId} property={property} currentValue={value} />
          <span className="text-[var(--text-secondary)]">{label}</span>
        </div>
        <span className="text-[var(--text-primary)] font-mono text-xs">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-[var(--hover-bg)] rounded appearance-none cursor-pointer accent-blue-500"
      />
      <KeyframeStrip clipId={clipId} property={property} />
    </div>
  );
}
