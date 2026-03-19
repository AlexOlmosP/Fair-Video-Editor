'use client';

import React from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { useProjectStore } from '@/store/useProjectStore';
import { secondsToDisplay } from '@/lib/time';
import { KeyframeToggle, KeyframeStrip } from './KeyframeEditor';
import { ANIMATION_PRESETS } from '@/engine/animation/presets';

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

export function PropertiesPanel() {
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const setClipKeyframes = useTimelineStore((s) => s.setClipKeyframes);
  const addAnimation = useTimelineStore((s) => s.addAnimation);
  const removeAnimation = useTimelineStore((s) => s.removeAnimation);

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

  const clip = clips[selectedClipIds[0]];
  if (!clip) return null;

  const activeFilters = clip.filters;
  const clipSourceDuration = clip.outPoint - clip.inPoint;

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

        {/* Animation Presets */}
        <PropertySection title="Animation Presets">
          <div className="flex gap-1 flex-wrap">
            {ANIMATION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  addAnimation(clip.id, {
                    presetId: preset.id,
                    presetLabel: preset.label,
                    startTime: 0,
                    endTime: clipSourceDuration,
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
            min={-960}
            max={960}
            step={1}
            onChange={(v) => updateClip(clip.id, { position: { ...clip.position, x: v } })}
            format={(v) => `${v}px`}
          />
          <KeyframedSlider
            clipId={clip.id}
            property="positionY"
            label="Position Y"
            value={clip.position.y}
            min={-540}
            max={540}
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

function PropertySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
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
  // Logarithmic slider: maps 0-1 range to 0.1-100 exponentially
  const toSlider = (speed: number) => Math.log10(speed * 10) / 3; // 0.1→0, 1→0.333, 10→0.666, 100→1
  const fromSlider = (pos: number) => Math.pow(10, pos * 3) / 10;  // 0→0.1, 0.333→1, 0.666→10, 1→100

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
          // Round to nice values
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
