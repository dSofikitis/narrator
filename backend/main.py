"""
narrator backend — FastAPI + edge-tts.

Uses Microsoft Edge's online neural voices via the `edge-tts` package:
~100+ truly natural-sounding voices, free, no API key required.

Endpoints:
  GET  /            → index.html
  GET  /static/*    → static assets
  GET  /health      → liveness probe
  GET  /voices      → curated voice catalogue (English on top, then locale)
  GET  /speak       → streams MP3 audio for one sentence
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import AsyncIterator

import edge_tts
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("narrator")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="narrator", version="2.0.0")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR.parent / "static"

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ----------------------------------------------------------------------------
# Voice catalogue
# ----------------------------------------------------------------------------

# Cache the upstream voice list. It's a few hundred voices and never changes
# at runtime; re-fetching on every UI load is wasteful.
_voice_cache: list[dict] | None = None
_voice_cache_lock = asyncio.Lock()


async def _load_voices() -> list[dict]:
    global _voice_cache
    async with _voice_cache_lock:
        if _voice_cache is not None:
            return _voice_cache
        raw = await edge_tts.list_voices()
        # Each entry has: ShortName, FriendlyName, Gender, Locale, ContentCategories,
        # VoicePersonalities, ... Trim to what the UI needs.
        trimmed: list[dict] = []
        for v in raw:
            trimmed.append({
                "id": v["ShortName"],                                # e.g. "en-US-AriaNeural"
                "name": v["FriendlyName"].replace("Microsoft ", ""),  # e.g. "Aria Online (Natural) - English (United States)"
                "short": v["ShortName"].split("-")[-1].replace("Neural", ""),  # e.g. "Aria"
                "gender": v["Gender"].lower(),                       # "female" / "male"
                "locale": v["Locale"],                               # "en-US"
                "personalities": v.get("VoicePersonalities", []),
            })
        _voice_cache = trimmed
        logger.info("loaded %d voices from edge-tts", len(trimmed))
        return trimmed


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/voices")
async def list_voices() -> JSONResponse:
    """
    Return all available voices, grouped for the UI:
      featured  → handpicked, high-quality English voices (Aria, Guy, Jenny, ...)
      english   → all other en-* voices, sorted by locale + name
      other     → everything else, sorted by locale + name
    """
    voices = await _load_voices()

    featured_ids = {
        "en-US-AriaNeural",       # warm female, US
        "en-US-JennyNeural",      # friendly female, US
        "en-US-GuyNeural",        # confident male, US
        "en-US-DavisNeural",      # natural male, US
        "en-GB-SoniaNeural",      # crisp female, UK
        "en-GB-RyanNeural",       # smooth male, UK
        "en-AU-NatashaNeural",    # bright female, AU
        "en-IE-EmilyNeural",      # warm female, IE
    }
    featured = [v for v in voices if v["id"] in featured_ids]
    featured.sort(key=lambda v: list(featured_ids).index(v["id"]) if v["id"] in featured_ids else 999)

    rest_english = [
        v for v in voices
        if v["locale"].startswith("en") and v["id"] not in featured_ids
    ]
    rest_english.sort(key=lambda v: (v["locale"], v["short"]))

    other = [v for v in voices if not v["locale"].startswith("en")]
    other.sort(key=lambda v: (v["locale"], v["short"]))

    return JSONResponse({
        "featured": featured,
        "english": rest_english,
        "other": other,
        "total": len(voices),
    })


# ----------------------------------------------------------------------------
# Speech synthesis
# ----------------------------------------------------------------------------

# edge-tts expects rate as "+0%" / "+15%" / "-25%" relative to baseline.
# Frontend sends a multiplier (1.0 = baseline). Convert here.
_RATE_RE = re.compile(r"^[+-]?\d+%$")
_VOLUME_RE = _RATE_RE


def _rate_pct(rate: float) -> str:
    pct = round((rate - 1.0) * 100)
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct}%"


def _volume_pct(volume: float) -> str:
    # frontend volume range 0..1 → edge-tts -100%..+0% (relative to default loudness)
    pct = round((volume - 1.0) * 100)
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct}%"


@app.get("/speak")
async def speak(
    text: str = Query(..., min_length=1, max_length=5000),
    voice: str = Query("en-US-AriaNeural"),
    rate: float = Query(1.0, ge=0.5, le=2.0),
    volume: float = Query(1.0, ge=0.0, le=1.0),
) -> StreamingResponse:
    """
    Stream MP3 audio for a chunk of text. Frontend calls this once per sentence
    so the user can pause/skip/rewind sentence-by-sentence.
    """
    voices = await _load_voices()
    valid_ids = {v["id"] for v in voices}
    if voice not in valid_ids:
        raise HTTPException(status_code=400, detail=f"unknown voice id: {voice}")

    rate_str = _rate_pct(rate)
    volume_str = _volume_pct(volume)

    async def generate() -> AsyncIterator[bytes]:
        try:
            communicate = edge_tts.Communicate(text, voice=voice, rate=rate_str, volume=volume_str)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
        except Exception as e:
            logger.exception("edge-tts stream failed")
            # mid-stream errors can't change HTTP status; just stop the stream
            return

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ----------------------------------------------------------------------------
# Index
# ----------------------------------------------------------------------------

@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
