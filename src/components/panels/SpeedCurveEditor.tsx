'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import type { Clip, Keyframe } from '@/store/types';
import { generateId } from '@/lib/id';

// ── SVG graph constants ────────────────────────────────────────────────────────
const VB_W = 200;
const VB_H = 80;
const PAD = 8; // padding inside viewBox so edge points aren't clipped
const GRAPH_W = VB_W - PAD * 2;
const GRAPH_H = VB_H - PAD * 2;

function timeToX(t: number, duration: number) {
  if (duration <= 0) return PAD;
  return PAD + (t / duration) * GRAPH_W;
}
function speedToY(s: number, maxSpeed: number) {
  if (maxSpeed <= 0) return PAD + GRAPH_H;
  return PAD + GRAPH_H - (s / maxSpeed) * GRAPH_H;
}
function xToTime(vx: number, duration: number) {
  return Math.max(0, Math.min(duration, ((vx - PAD) / GRAPH_W) * duration));
}
function yToSpeed(vy: number, maxSpeed: number) {
  return Math.max(0.05, (1 - (vy - PAD) / GRAPH_H) * maxSpeed);
}

// ── Speed-curve presets ────────────────────────────────────────────────────────
interface PresetPoint { time: number; speed: number }

const SPEED_CURVE_PRESETS = [
  {
    id: 'bullet',
    label: 'Bullet',
    description: 'Fast → slow → fast',
    points: (d: number): PresetPoint[] => [
      { time: 0,        speed: 3    },
      { time: d * 0.28, speed: 3    },
      { time: d * 0.35, speed: 0.15 },
      { time: d * 0.65, speed: 0.15 },
      { time: d * 0.72, speed: 3    },
      { time: d,        speed: 3    },
    ],
  },
  {
    id: 'montage',
    label: 'Montage',
    description: 'Rhythmic alternation',
    points: (d: number): PresetPoint[] => [
      { time: 0,        speed: 2.5 },
      { time: d * 0.25, speed: 0.4 },
      { time: d * 0.5,  speed: 2.5 },
      { time: d * 0.75, speed: 0.4 },
      { time: d,        speed: 2.5 },
    ],
  },
  {
    id: 'hero-time',
    label: 'Hero Time',
    description: 'Dramatic slow-motion',
    points: (d: number): PresetPoint[] => [
      { time: 0,        speed: 1   },
      { time: d * 0.15, speed: 1   },
      { time: d * 0.25, speed: 0.1 },
      { time: d * 0.75, speed: 0.1 },
      { time: d * 0.85, speed: 1   },
      { time: d,        speed: 1   },
    ],
  },
  {
    id: 'flash-in',
    label: 'Flash In',
    description: 'Fast then normal',
    points: (d: number): PresetPoint[] => [
      { time: 0,        speed: 4 },
      { time: d * 0.35, speed: 1 },
      { time: d,        speed: 1 },
    ],
  },
  {
    id: 'flash-out',
    label: 'Flash Out',
    description: 'Normal then fast',
    points: (d: number): PresetPoint[] => [
      { time: 0,        speed: 1 },
      { time: d * 0.65, speed: 1 },
      { time: d,        speed: 4 },
    ],
  },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  clip: Clip;
}

export function SpeedCurveEditor({ clip }: Props) {
  const setClipKeyframes = useTimelineStore((s) => s.setClipKeyframes);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ kfId: string; maxSpeed: number } | null>(null);

  const speedKfs = clip.keyframes
    .filter((kf) => kf.property === 'speed')
    .sort((a, b) => a.time - b.time);
  const hasSpeedCurve = speedKfs.length >= 2;
  const duration = clip.duration;

  const rawMax = speedKfs.length > 0 ? Math.max(...speedKfs.map((kf) => kf.value)) : 1;
  const maxSpeed = Math.max(4, rawMax * 1.15);

  // ── Preset application ───────────────────────────────────────────────────────
  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = SPEED_CURVE_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const nonSpeedKfs = clip.keyframes.filter((kf) => kf.property !== 'speed');
      const newKfs: Keyframe[] = preset.points(duration).map((pt) => ({
        id: generateId(),
        property: 'speed',
        time: pt.time,
        value: pt.speed,
        easing: 'ease-in-out' as const,
      }));
      setClipKeyframes(clip.id, [...nonSpeedKfs, ...newKfs]);
    },
    [clip.id, clip.keyframes, duration, setClipKeyframes]
  );

  const clearCurve = useCallback(() => {
    setClipKeyframes(clip.id, clip.keyframes.filter((kf) => kf.property !== 'speed'));
  }, [clip.id, clip.keyframes, setClipKeyframes]);

  // ── SVG coordinate helper ────────────────────────────────────────────────────
  const clientToVB = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { vx: 0, vy: 0 };
    const r = svg.getBoundingClientRect();
    return {
      vx: ((clientX - r.left) / r.width) * VB_W,
      vy: ((clientY - r.top) / r.height) * VB_H,
    };
  }, []);

  // ── Graph mouse interactions ─────────────────────────────────────────────────
  const onSvgMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { vx, vy } = clientToVB(e.clientX, e.clientY);
      const HIT = 10; // viewBox units hit radius

      // Check if we're hitting an existing point
      for (const kf of speedKfs) {
        const px = timeToX(kf.time, duration);
        const py = speedToY(kf.value, maxSpeed);
        if (Math.abs(vx - px) < HIT && Math.abs(vy - py) < HIT) {
          draggingRef.current = { kfId: kf.id, maxSpeed };
          return;
        }
      }

      // Empty area — add a new point
      const newKf: Keyframe = {
        id: generateId(),
        property: 'speed',
        time: xToTime(vx, duration),
        value: yToSpeed(vy, maxSpeed),
        easing: 'ease-in-out',
      };
      const nonSpeedKfs = clip.keyframes.filter((kf) => kf.property !== 'speed');
      setClipKeyframes(clip.id, [...nonSpeedKfs, ...speedKfs, newKf]);
      draggingRef.current = { kfId: newKf.id, maxSpeed };
    },
    [clientToVB, speedKfs, duration, maxSpeed, clip.id, clip.keyframes, setClipKeyframes]
  );

  const onSvgDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const { vx, vy } = clientToVB(e.clientX, e.clientY);
      const HIT = 12;
      for (const kf of speedKfs) {
        const px = timeToX(kf.time, duration);
        const py = speedToY(kf.value, maxSpeed);
        if (Math.abs(vx - px) < HIT && Math.abs(vy - py) < HIT) {
          const nonSpeedKfs = clip.keyframes.filter((k) => k.property !== 'speed');
          const remaining = speedKfs.filter((k) => k.id !== kf.id);
          setClipKeyframes(clip.id, [...nonSpeedKfs, ...remaining]);
          return;
        }
      }
    },
    [clientToVB, speedKfs, duration, maxSpeed, clip.id, clip.keyframes, setClipKeyframes]
  );

  // Global move/up: read from store directly to avoid stale closures
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = draggingRef.current;
      if (!drag) return;
      const svg = svgRef.current;
      if (!svg) return;

      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * VB_W;
      const vy = ((e.clientY - r.top) / r.height) * VB_H;

      const { clips } = useTimelineStore.getState();
      const c = clips[clip.id];
      if (!c) return;

      const curSpeedKfs = c.keyframes.filter((kf) => kf.property === 'speed');
      const curNonSpeed = c.keyframes.filter((kf) => kf.property !== 'speed');
      const curDuration = c.duration;

      const updated = curSpeedKfs.map((kf) =>
        kf.id === drag.kfId
          ? { ...kf, time: xToTime(vx, curDuration), value: yToSpeed(vy, drag.maxSpeed) }
          : kf
      );
      setClipKeyframes(clip.id, [...curNonSpeed, ...updated]);
    };
    const onUp = () => { draggingRef.current = null; };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clip.id, setClipKeyframes]);

  // ── SVG rendering ────────────────────────────────────────────────────────────
  const pts = speedKfs.map((kf) => ({
    x: timeToX(kf.time, duration),
    y: speedToY(kf.value, maxSpeed),
    id: kf.id,
    speed: kf.value,
  }));

  const polylinePoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const gridSpeeds = [1, 2, 3, 4].filter((v) => v < maxSpeed * 0.98);

  return (
    <div className="space-y-2">
      {/* Presets */}
      <div className="flex gap-1 flex-wrap">
        {SPEED_CURVE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            title={p.description}
            className="px-2 py-1 rounded-lg text-[10px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] btn-press transition-colors"
          >
            {p.label}
          </button>
        ))}
        {hasSpeedCurve && (
          <button
            onClick={clearCurve}
            className="px-2 py-1 rounded-lg text-[10px] font-medium bg-red-900/40 text-red-400 hover:bg-red-900/60 btn-press transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Graph */}
      <div className="relative rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-tertiary)]/40">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="w-full cursor-crosshair select-none"
          style={{ height: 84 }}
          onMouseDown={onSvgMouseDown}
          onDoubleClick={onSvgDoubleClick}
        >
          {/* Horizontal grid lines */}
          {gridSpeeds.map((v) => {
            const gy = speedToY(v, maxSpeed);
            return (
              <g key={v}>
                <line
                  x1={PAD} y1={gy} x2={VB_W - PAD} y2={gy}
                  stroke="rgba(255,255,255,0.07)" strokeWidth="0.6"
                />
                <text x={PAD + 2} y={gy - 1.5} fontSize="5.5" fill="rgba(255,255,255,0.28)">
                  {v}x
                </text>
              </g>
            );
          })}

          {/* 1× dashed reference line */}
          {maxSpeed > 1 && (
            <line
              x1={PAD} y1={speedToY(1, maxSpeed)} x2={VB_W - PAD} y2={speedToY(1, maxSpeed)}
              stroke="rgba(99,149,255,0.35)" strokeWidth="0.8" strokeDasharray="4 3"
            />
          )}

          {/* Speed curve */}
          {pts.length > 1 && (
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          )}

          {/* Fill under curve */}
          {pts.length > 1 && (() => {
            const base = PAD + GRAPH_H;
            const fill = `M ${pts[0].x} ${base} L ${polylinePoints.replace(/,/g, ' L ')} L ${pts[pts.length - 1].x} ${base} Z`;
            return (
              <path d={fill} fill="rgba(59,130,246,0.08)" />
            );
          })()}

          {/* Control points */}
          {pts.map((pt) => (
            <circle
              key={pt.id}
              cx={pt.x} cy={pt.y} r={4}
              fill="#3b82f6" stroke="white" strokeWidth="1.5"
              style={{ cursor: 'grab' }}
            />
          ))}

          {/* Time axis labels */}
          <text x={PAD} y={VB_H - 1} fontSize="5" fill="rgba(255,255,255,0.22)">0s</text>
          <text
            x={VB_W - PAD - 2} y={VB_H - 1} fontSize="5" fill="rgba(255,255,255,0.22)"
            textAnchor="end"
          >
            {duration.toFixed(1)}s
          </text>
        </svg>

        {!hasSpeedCurve && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none pb-2">
            <span className="text-[10px] text-[var(--text-muted)]">
              Choose a preset or click graph to add points
            </span>
          </div>
        )}
      </div>

      {hasSpeedCurve && (
        <p className="text-[10px] text-[var(--text-muted)]">
          Drag points · Double-click to remove · Click graph to add
        </p>
      )}
    </div>
  );
}
