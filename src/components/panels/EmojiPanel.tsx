'use client';

import { useState } from 'react';
import { useTimelineStore } from '@/store/useTimelineStore';
import { generateId } from '@/lib/id';

const EMOJI_CATEGORIES = [
  { name: 'Smileys', emojis: ['😀','😂','😊','😍','🥰','😎','🤩','😢','😤','🤔','😱','🤗','😴','🙄','😇','🥳','😈','🤯','🥺','😏'] },
  { name: 'Gestures', emojis: ['👍','👎','👋','🤝','👏','🙌','💪','🤞','✌️','👆','👇','👈','👉','☝️','🤙','🤘','🖐️','✊','👊','🫶'] },
  { name: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💗','💖','💕','💞','💘','💝','💔','❤️‍🔥','💯','✨','🌟','⭐'] },
  { name: 'Animals', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🦄','🐝','🦋','🐢','🐙'] },
  { name: 'Food', emojis: ['🍎','🍕','🍔','🌮','🍟','🍩','🎂','🍪','🍿','☕','🧁','🍉','🍓','🥑','🍇','🍺','🧃','🍫','🥤','🍦'] },
  { name: 'Objects', emojis: ['🔥','💎','🎵','🎬','📱','💡','🎯','🏆','🎮','📸','🎨','🎧','💰','🚀','💣','🎪','🎭','🎤','📣','🔔'] },
];

export function EmojiPanel() {
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const [searchQuery, setSearchQuery] = useState('');

  const addEmoji = (emoji: string) => {
    const { playheadTime, tracks, trackOrder, addTrack, addClip } = useTimelineStore.getState();

    let textTrackId = trackOrder.find((id) => tracks[id]?.type === 'text');
    if (!textTrackId) {
      textTrackId = addTrack('text', 'Text');
    }

    addClip({
      assetId: `emoji-${generateId()}`,
      trackId: textTrackId,
      startTime: playheadTime,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
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
        text: emoji,
        fontFamily: 'system-ui',
        fontSize: 120,
        color: '#ffffff',
      },
    });
  };

  const filteredEmojis = searchQuery
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) => e.includes(searchQuery))
    : EMOJI_CATEGORIES.find((c) => c.name === activeCategory)?.emojis ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-[var(--border-color)]">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Emojis</h3>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <input
          type="text"
          placeholder="Search emojis..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-blue-500"
        />
      </div>

      {/* Category tabs */}
      {!searchQuery && (
        <div className="flex gap-1 px-3 pt-2 pb-1 overflow-x-auto flex-shrink-0">
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(cat.name)}
              className={`px-2 py-1 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                activeCategory === cat.name
                  ? 'bg-blue-600 text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-6 gap-1">
          {filteredEmojis.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              onClick={() => addEmoji(emoji)}
              className="w-full aspect-square flex items-center justify-center text-2xl rounded hover:bg-[var(--bg-tertiary)] transition-colors"
              title={`Add ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
