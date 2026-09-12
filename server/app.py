"""VFB Fly Explorer API.

Small companion service for the Godot app. It exists so the Claude API key can
live in a Render secret instead of shipping to browsers. Everything here has a
programmatic fallback in the app, so the service is optional: without an
ANTHROPIC_API_KEY it still serves YouTube metadata and reports ai=false.

Endpoints
  GET  /api/health              -> {ok, ai, model}
  GET  /api/youtube?id=<id>     -> {id, title, author, thumbnail}
  POST /api/narrate {state}     -> {text, ai}      what the fly is doing / feeling
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

log = logging.getLogger("vfb")
logging.basicConfig(level=logging.INFO)

MODEL = os.environ.get("VFB_MODEL", "claude-opus-5")
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MAX_CONCURRENT_AI = int(os.environ.get("VFB_MAX_CONCURRENT_AI", "4"))
NARRATE_MIN_INTERVAL = float(os.environ.get("VFB_NARRATE_MIN_INTERVAL", "6"))
YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")

app = FastAPI(title="VFB Fly Explorer API", version="0.2")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"]
)

_client = None
if API_KEY:
    try:
        import anthropic

        _client = anthropic.Anthropic(api_key=API_KEY, max_retries=1, timeout=60.0)
    except Exception as e:  # noqa: BLE001
        log.warning("anthropic client unavailable: %s", e)

_ai_slots = threading.BoundedSemaphore(MAX_CONCURRENT_AI)
_last_narrate: dict[str, float] = {}
_yt_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


def ai_enabled() -> bool:
    return _client is not None


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class NarrateRequest(BaseModel):
    state: dict[str, Any] = Field(default_factory=dict)


SYSTEM_NARRATE = (
    "You rephrase, for a public science website, a JSON snapshot produced by a circuit model of a fruit fly's "
    "brain: population firing rates (e.g. T4T5, LPLC2, GF, DNa02, DNp09, PAM, PPL1, dFB), internal state levels "
    "(defensive arousal, nociception, hunger, reward, aversion, sleep pressure, arousal, novelty), sensory "
    "signals and the motor readout. Write 2 short present-tense sentences ('The fly ...') that explain what the "
    "fly is doing and why, quoting only populations and states present in the snapshot. Do not add anything "
    "the snapshot does not contain, do not speculate about content the fly might be watching, and do not use "
    "human emotion words except the state names given. No headings, lists or emoji."
)

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else request.client.host if request.client else "?")


def _text_of(response: Any) -> str:
    parts = []
    for block in getattr(response, "content", []) or []:
        if getattr(block, "type", "") == "text":
            parts.append(block.text)
    return "\n".join(parts).strip()


def call_narrate(state: dict[str, Any]) -> str | None:
    """Ask Claude for a two-sentence narration; None on any failure or refusal."""
    if _client is None:
        return None
    payload = json.dumps(state, ensure_ascii=False)[:6000]
    try:
        with _ai_slots:
            response = _client.beta.messages.create(
                model=MODEL,
                max_tokens=300,
                system=SYSTEM_NARRATE,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "low"},
                messages=[{"role": "user", "content": f"Snapshot:\n{payload}"}],
            )
    except Exception as e:  # noqa: BLE001 - any API error degrades to the programmatic narrator
        log.warning("narrate failed: %s", e)
        return None
    if getattr(response, "stop_reason", "") == "refusal":
        return None
    text = _text_of(response)
    return text or None


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "vfb-fly-explorer-api", "ai": ai_enabled(), "docs": "/docs"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "ai": ai_enabled(), "model": MODEL if ai_enabled() else None}


@app.get("/api/youtube")
def youtube(id: str) -> dict[str, Any]:  # noqa: A002
    vid = id.strip()
    if not YT_ID_RE.match(vid):
        raise HTTPException(400, "invalid video id")
    now = time.time()
    with _lock:
        cached = _yt_cache.get(vid)
    if cached and now - cached[0] < 86400:
        return cached[1]
    info: dict[str, Any] = {"id": vid, "title": "", "author": "", "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"}
    try:
        r = httpx.get("https://www.youtube.com/oembed", params={"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"}, timeout=8.0)
        if r.status_code == 200:
            d = r.json()
            info["title"] = str(d.get("title", ""))
            info["author"] = str(d.get("author_name", ""))
            if d.get("thumbnail_url"):
                info["thumbnail"] = str(d["thumbnail_url"])
    except Exception as e:  # noqa: BLE001
        log.info("oembed failed for %s: %s", vid, e)
    with _lock:
        _yt_cache[vid] = (now, info)
    return info


@app.post("/api/narrate")
def narrate(req: NarrateRequest, request: Request) -> dict[str, Any]:
    ip = client_ip(request)
    now = time.time()
    with _lock:
        last = _last_narrate.get(ip, 0.0)
        if now - last < NARRATE_MIN_INTERVAL:
            raise HTTPException(429, "too many narration requests; slow down")
        _last_narrate[ip] = now
        if len(_last_narrate) > 5000:
            _last_narrate.clear()
    if not ai_enabled():
        return {"text": "", "ai": False}
    text = call_narrate(req.state)
    return {"text": text or "", "ai": bool(text)}
