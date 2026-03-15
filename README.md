# FrameForge — Browser-Based Video Editor

> **Status: Work in Progress** — This project is under active development. Features may change, break, or be incomplete. Contributions and feedback are welcome!

A private, fully client-side video editor built with Next.js 16 and React 19. Edit videos directly in your browser — no uploads, no servers, no subscriptions. All processing happens locally using Canvas 2D rendering and FFmpeg.wasm.

## Features

### Timeline & Editing
- **Multi-track timeline** with 5 track types: Video, Audio, Overlay, Text, and Caption
- **Drag-and-drop** media import and clip placement
- **Clip trimming** with in/out points and speed control (0.25x–8x)
- **Transitions** between clips (fade-black, fade-white, crossfade)
- **Undo/Redo** history
- **Keyboard shortcuts** for common actions

### Preview & Composition
- **Real-time canvas preview** with playhead scrubbing
- **Transform controls** — position, scale, rotation with drag handles
- **Aspect ratio lock/unlock** for free or uniform scaling
- **Edge snapping** when dragging elements near borders
- **Blend modes** — normal, multiply, screen, overlay, darken, lighten
- **Picture-in-Picture presets** — TL, TR, BL, BR, Center

### Animations & Keyframes
- **Built-in animation presets** — Zoom In/Out, Ken Burns, Spin 360, Fade In/Out, Bounce
- **Animation sub-tracks** — drag, trim, and reposition animations visually in the timeline
- **Custom keyframes** with easing (linear, ease-in, ease-out, ease-in-out, bezier)
- **Animatable properties** — opacity, rotation, scale, position

### Effects & AI
- **Filters** — brightness, contrast, saturation, blur, sharpen, grayscale, sepia, invert, hue rotate
- **Chroma Key** — green/blue screen removal
- **AI Background Removal** — powered by MediaPipe
- **Auto-Caption Generation** — speech recognition to timed subtitles (Chrome/Edge)
- **Text-to-Speech** — browser-native voice synthesis with language selection

### Export
- **5 quality presets** — 720p, 1080p, 1080p60, 4K, 4K60
- **Aspect ratios** — 16:9, 9:16, 4:5, 1:1, or native
- **H.264 + AAC** in MP4 container (FastStart for web streaming)
- **Multi-track audio mixing** during export
- All encoding runs client-side via FFmpeg.wasm

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Video Encoding | FFmpeg.wasm (client-side) |
| AI/ML | MediaPipe Tasks Vision |
| Font | Geist (via next/font) |

## Getting Started

```bash
# Clone the repository
git clone https://github.com/AlexOlmosP/Fair-Video-Editor.git
cd video-editor

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser (Chrome or Edge recommended for full feature support).

### Quick Start
1. **Import media** — drag files into the Assets panel or click to browse
2. **Build your timeline** — drag assets onto tracks to create clips
3. **Edit** — trim, move, add effects and animations from the panels
4. **Preview** — hit play or scrub the playhead to review your edit
5. **Export** — choose a preset and aspect ratio, then download your video

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | Full support (recommended) |
| Edge | Full support |
| Firefox | Partial (no auto-captions/TTS) |
| Safari | Limited (no FFmpeg.wasm) |

## License

MIT
