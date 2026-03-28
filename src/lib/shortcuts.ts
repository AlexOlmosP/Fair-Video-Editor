export type ShortcutCategory =
  | 'Playback'
  | 'Navigation'
  | 'Timeline'
  | 'Markers'
  | 'History'
  | 'Project'
  | 'General';

export interface ShortcutDef {
  /** Display labels for each key, e.g. ['Ctrl', 'Z'] */
  keys: string[];
  description: string;
  category: ShortcutCategory;
  /** Optional note shown beneath the description */
  condition?: string;
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  'Playback',
  'Navigation',
  'Timeline',
  'Markers',
  'History',
  'Project',
  'General',
];

export const SHORTCUTS: ShortcutDef[] = [
  // ── Playback ────────────────────────────────────────────────────
  { keys: ['Space'],          description: 'Play / Pause',                          category: 'Playback' },
  { keys: ['J'],              description: 'Shuttle backward  ×1 → ×2 → ×4 → ×8',  category: 'Playback' },
  { keys: ['K'],              description: 'Stop playback',                          category: 'Playback' },
  { keys: ['L'],              description: 'Shuttle forward   ×1 → ×2 → ×4 → ×8',  category: 'Playback' },

  // ── Navigation ──────────────────────────────────────────────────
  { keys: ['←'],             description: 'Step back 0.1 s',    category: 'Navigation' },
  { keys: ['→'],             description: 'Step forward 0.1 s', category: 'Navigation' },
  { keys: ['Ctrl', '←'],    description: 'Step back 1 s',       category: 'Navigation' },
  { keys: ['Ctrl', '→'],    description: 'Step forward 1 s',    category: 'Navigation' },

  // ── Timeline ────────────────────────────────────────────────────
  { keys: ['Del'],            description: 'Delete selected clip(s)',   category: 'Timeline' },
  {
    keys: ['Ctrl', 'S'],
    description: 'Split clip at playhead',
    category: 'Timeline',
    condition: 'Requires exactly 1 clip selected',
  },
  { keys: ['Ctrl', 'A'],      description: 'Select all clips', category: 'Timeline' },
  { keys: ['Esc'],            description: 'Deselect all',     category: 'Timeline' },

  // ── Markers & In/Out Points ─────────────────────────────────────
  { keys: ['M'], description: 'Add marker at playhead', category: 'Markers' },
  { keys: ['I'], description: 'Set in-point',           category: 'Markers' },
  { keys: ['O'], description: 'Set out-point',          category: 'Markers' },

  // ── History ─────────────────────────────────────────────────────
  { keys: ['Ctrl', 'Z'],              description: 'Undo',             category: 'History' },
  { keys: ['Ctrl', 'Shift', 'Z'],     description: 'Redo',             category: 'History' },
  { keys: ['Ctrl', 'Y'],              description: 'Redo (alternate)', category: 'History' },

  // ── Project ─────────────────────────────────────────────────────
  { keys: ['Ctrl', 'S'], description: 'Save project', category: 'Project' },

  // ── General ─────────────────────────────────────────────────────
  { keys: ['?'], description: 'Show keyboard shortcuts', category: 'General' },
];

/** Returns shortcuts grouped by category, preserving SHORTCUT_CATEGORIES order. */
export function getShortcutsByCategory(): Record<ShortcutCategory, ShortcutDef[]> {
  const result = {} as Record<ShortcutCategory, ShortcutDef[]>;
  for (const cat of SHORTCUT_CATEGORIES) {
    result[cat] = SHORTCUTS.filter((s) => s.category === cat);
  }
  return result;
}
