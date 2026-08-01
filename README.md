# WCA Editor

A minimal, browser-based video editor for World Cruise Academy — trim a
clip, add a caption, drop music under it, stamp the WCA logo, and export.
No build step, no libraries, no server: open `index.html` in Chrome.

## Why the browser
The modern web has real video APIs now, so a CapCut-style editor can run
entirely client-side. v1 uses the simplest reliable path — `<canvas>`
compositing + `MediaRecorder` — which works today in every Chromium
browser with zero dependencies. A WebCodecs MP4 exporter is the planned
upgrade (faster, real `.mp4`, frame-accurate).

## Run it
```
# any static server, e.g.
npx serve .
# then open the printed URL in Chrome/Edge
```
Or just double-click `index.html`. (A server is only needed once we add
cross-origin assets.)

## Features (v1)
- Import a video, scrub, play/pause (Space)
- **Trim** with draggable in/out handles on the timeline
- **Caption**: text, position (top/center/bottom), size, color, outline —
  live preview, word-wrapped
- **Music** track with independent volume vs. the video's own audio
- **WCA watermark** (round logo, bottom-right, toggle)
- **Export** → `.webm` (VP9/opus), watermark + caption baked in

## Known limits (v1)
- Single video clip (multi-clip timeline is next)
- Export is `.webm` and records in real time (a 30s clip takes ~30s).
  WebCodecs export will make it `.mp4` and faster than real time.
- Chrome/Edge/Android-Chrome first; Safari's MediaRecorder is spottier.

## Roadmap
1. Multi-clip timeline (drag, reorder, split)
2. WebCodecs `VideoEncoder` → real MP4, faster-than-real-time export
3. Auto-captions (Whisper) for the drama subtitles
4. Transitions, filters, keyframe zoom
5. Embed into `app.worldcruiseacademy.co.id` and push exports straight to Bunny/Reels

## Layout
- `index.html` — UI + styles
- `editor.js` — all logic (load, draw, trim, transport, export)
