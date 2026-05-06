# narrator

Read anything aloud in the browser with neural voices. FastAPI + `edge-tts` on the back, terminal-aesthetic single-page UI on the front. Matches the design language of [dimitrisofikitis.com](https://dimitrisofikitis.com).

## What's in it

- **300+ neural voices** via `edge-tts` (Microsoft Edge's online TTS) — free, no API key, sound nothing like your OS's robot voices. Curated into `featured` (handpicked EN), `english`, `other` (~275 across 70+ locales).
- **Custom voice picker** — searchable dropdown filters by name / locale / gender as you type; click outside or `Esc` to close.
- **Sentence-by-sentence playback** with smart chunking — splits on `.!?` (respecting abbreviations like `Mr.`, `U.S.`, `e.g.` and decimals like `3.14`), then sub-divides long sentences on commas / semicolons / colons / em-dashes so no chunk exceeds ~16 words. Faster initial playback, more responsive seeking.
- **Seek scrubber** — drag the slider under the status to jump to any sentence; cursor moves but **doesn't auto-play** (press play to hear it).
- **Speed (0.75×–2×) and volume** — both client-side via `audio.playbackRate` (with `preservesPitch=true`) and `audio.volume`. Cache invariant to either, so changes are instant and don't restart the current sentence.
- **Pre-fetching** — the next sentence is fetched while the current plays, so transitions feel seamless.
- **Light & dark themes** — auto-detect from `prefers-color-scheme`, persist via `localStorage`. Toggle in the top-right.
- **Text persistence** — what you typed or loaded survives a page refresh (`localStorage`, debounced).
- **Keyboard shortcuts** — `Space` toggle play/pause, `←/→` skip sentences, `Esc` stops, `Ctrl+R` reloads (browser default; your text stays).
- **Auto-rewind** — at end of input, cursor parks back at sentence 1 ready to re-read.

## Run locally (Windows)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python backend/main.py
```

Open http://127.0.0.1:8000

## Architecture

```
┌────────────┐  GET /voices         ┌──────────────┐
│  frontend  │ ───────────────────► │   backend    │
│  (static)  │                      │  (FastAPI)   │
│            │  GET /speak?text=…   │              │
│            │ ◄─── MP3 stream ──── │   edge-tts   │
│            │                      │              │
└────────────┘                      └──────────────┘
                                          │
                                          ▼
                                Microsoft Edge online TTS
```

Frontend splits the input into chunks (~16 words each) and requests one MP3 per chunk. The backend just streams the bytes from `edge-tts` with the requested voice — rate / volume are applied client-side so cached audio stays valid across slider changes. State lives entirely on the client; the backend is stateless.

A monotonic `playToken` guards against race conditions when you change voice or scrub mid-playback (stale `ended` events from pre-empted audio don't chain forward).

## Project layout

```
narrator/
├── backend/
│   ├── main.py            # FastAPI app: /voices, /speak, /health, /
│   └── requirements.txt   # fastapi · uvicorn · edge-tts
├── static/
│   ├── index.html         # single-page layout (terminal aesthetic)
│   ├── style.css          # design system (palette · JetBrains Mono · custom dropdown · notebook-tab labels)
│   └── app.js             # client logic (TTS fetch, audio chain, custom select, seek, persistence)
├── LICENSE
└── README.md
```

## Notes

- Requires an internet connection (edge-tts hits Microsoft's online endpoint).
- Voices marked **featured** are handpicked English neural voices that sound the most natural; the full catalogue (~300 across 70+ locales) is in the dropdown.
- All UI assets are local — fonts loaded once from JetBrains' jsdelivr mirror, no per-view tracking pings.
- Pinned to `edge-tts==7.2.8` because earlier `6.x` versions can't sign the new `Sec-MS-GEC` token Microsoft requires on the WebSocket handshake.

## License

MIT — © 2026 [Dimitris Sofikitis](https://dimitrisofikitis.com). See [LICENSE](LICENSE).
