'use client';

import { useProjectStore } from '@/store/useProjectStore';
import { ASPECT_RATIO_PRESETS } from '@/lib/constants';

const FORMAT_PRESETS = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '1:1', width: 1080, height: 1080 },
];

const FPS_OPTIONS = [24, 25, 30, 60];

export function SettingsPanel() {
  const settings = useProjectStore((s) => s.settings);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const safeAreaRatio = useProjectStore((s) => s.safeAreaRatio);
  const setSafeAreaRatio = useProjectStore((s) => s.setSafeAreaRatio);
  const aspectRatioLocked = useProjectStore((s) => s.aspectRatioLocked);
  const setAspectRatioLocked = useProjectStore((s) => s.setAspectRatioLocked);

  const currentFormat = FORMAT_PRESETS.find(
    (p) => p.width === settings.width && p.height === settings.height
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-[var(--border-color)]">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Settings</h3>
      </div>

      <div className="p-3 space-y-5 overflow-y-auto">
        {/* Canvas Format */}
        <div>
          <label className="block text-[11px] text-[var(--text-secondary)] font-medium mb-2">Canvas Format</label>
          <div className="grid grid-cols-2 gap-2">
            {FORMAT_PRESETS.map((preset) => {
              const isActive = currentFormat?.label === preset.label;
              const aspectW = preset.width > preset.height ? 32 : Math.round(32 * preset.width / preset.height);
              const aspectH = preset.height > preset.width ? 32 : Math.round(32 * preset.height / preset.width);
              return (
                <button
                  key={preset.label}
                  onClick={() => updateSettings({ width: preset.width, height: preset.height })}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg btn-press transition-colors ${
                    isActive
                      ? 'bg-blue-600/20 border border-blue-500 text-white'
                      : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                  }`}
                >
                  <div
                    className={`border-2 rounded-sm ${isActive ? 'border-blue-400' : 'border-[var(--text-muted)]'}`}
                    style={{ width: aspectW, height: aspectH }}
                  />
                  <span className="text-xs font-medium">{preset.label}</span>
                  <span className="text-[9px] text-[var(--text-muted)]">{preset.width}x{preset.height}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Dimensions */}
        <div>
          <label className="block text-[11px] text-[var(--text-secondary)] font-medium mb-2">Custom Size</label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={settings.width}
              onChange={(e) => updateSettings({ width: Math.max(100, parseInt(e.target.value) || 100) })}
              className="flex-1 px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-blue-500"
            />
            <span className="text-[var(--text-muted)] text-xs">x</span>
            <input
              type="number"
              value={settings.height}
              onChange={(e) => updateSettings({ height: Math.max(100, parseInt(e.target.value) || 100) })}
              className="flex-1 px-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Safe Area Overlay */}
        <div>
          <label className="block text-[11px] text-[var(--text-secondary)] font-medium mb-2">Safe Area Overlay</label>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setSafeAreaRatio(null)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium btn-press transition-colors ${
                safeAreaRatio === null
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
              }`}
            >
              Off
            </button>
            {ASPECT_RATIO_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setSafeAreaRatio(safeAreaRatio === preset.label ? null : preset.label)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium btn-press transition-colors ${
                  safeAreaRatio === preset.label
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Aspect Ratio Lock */}
        <div>
          <label className="block text-[11px] text-[var(--text-secondary)] font-medium mb-2">Scaling Behavior</label>
          <button
            onClick={() => setAspectRatioLocked(!aspectRatioLocked)}
            className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium btn-press transition-colors ${
              aspectRatioLocked
                ? 'bg-blue-600/20 border border-blue-500 text-blue-300'
                : 'bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {aspectRatioLocked ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              )}
            </svg>
            {aspectRatioLocked ? 'Aspect Ratio Locked' : 'Free Scaling'}
          </button>
        </div>

        {/* Frame Rate */}
        <div>
          <label className="block text-[11px] text-[var(--text-secondary)] font-medium mb-2">Frame Rate</label>
          <div className="flex gap-1">
            {FPS_OPTIONS.map((fps) => (
              <button
                key={fps}
                onClick={() => updateSettings({ frameRate: fps })}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium btn-press transition-colors ${
                  settings.frameRate === fps
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]'
                }`}
              >
                {fps}fps
              </button>
            ))}
          </div>
        </div>

        {/* Background Color */}
        <div>
          <label className="block text-[11px] text-[var(--text-secondary)] font-medium mb-2">Background</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={settings.backgroundColor}
              onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
              className="w-8 h-8 rounded border border-[var(--border-color)] cursor-pointer bg-transparent"
            />
            <span className="text-xs text-[var(--text-secondary)] font-mono">{settings.backgroundColor}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
