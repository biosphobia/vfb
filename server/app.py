"""VFB Fly Explorer API.

Small companion service for the Godot app. It exists so the Claude API key can
live in a Render secret instead of shipping to browsers. Everything here has a
programmatic fallback in the app, so the service is optional: without an
ANTHROPIC_API_KEY it still serves YouTube metadata and reports ai=false.

Endpoints
  GET  /api/health              -> {ok, ai, model}
  GET  /api/youtube?id=<id>     -> {id, title, author, thumbnail}
  POST /api/narrate {state}     -> {text, ai}      what the fly is doing / feeling
  POST /api/react  {id,title}   -> {mood, summary, beats[], ai}  how it reacts to a video
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
_react_cache: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def ai_enabled() -> bool:
    return _client is not None


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class NarrateRequest(BaseModel):
    state: dict[str, Any] = Field(default_factory=dict)


class ReactRequest(BaseModel):
    id: str = ""
    title: str = ""
    author: str = ""


class Beat(BaseModel):
    at_s: float = Field(description="seconds after the video starts playing")
    action: str = Field(description="one of: look, startle, walk, fly, feed, groove, antenna, think, rest")
    note: str = Field(description="one short sentence, plain language, what the fly does and why")


class ReactionPlan(BaseModel):
    mood: str = Field(description="one of: curious, excited, hungry, scared, groovy, sleepy")
    summary: str = Field(description="two friendly sentences about how this fly reacts to this video")
    beats: list[Beat] = Field(description="4 to 8 beats spread over the first 90 seconds")


SYSTEM_NARRATE = (
    "You narrate a small 3D fruit fly for a public science website. Visitors are not scientists. "
    "You receive a JSON snapshot of what the fly is doing (behaviour, which brain regions are active, "
    "what it is looking at or reacting to, any video it is watching). Write 2 short sentences in "
    "plain, warm, present-tense English from the fly's point of view in the third person ('The fly ...'). "
    "Mention one real brain region from the snapshot when it fits (e.g. mushroom body for memory, "
    "antennal lobe for smell, central complex for steering, optic lobes for vision). "
    "Never invent facts about the video beyond its title. No headings, no lists, no emoji."
)

SYSTEM_REACT = (
    "You design how a curious 3D fruit fly reacts to a YouTube video, using only the title and channel. "
    "Pick a mood and 4-8 timed beats over the first 90 seconds. Beat actions must be from the allowed list. "
    "Food, fruit, sugar, cooking -> hungry (feed). Danger, spiders, swatting, horror -> scared (startle, fly). "
    "Music, dance -> groovy (groove). Calm nature, sleep -> sleepy. Otherwise curious. "
    "Keep notes friendly and short, for a general audience."
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


def call_react(video_id: str, title: str, author: str) -> dict[str, Any] | None:
    if _client is None:
        return None
    prompt = f"Video title: {title!r}\nChannel: {author!r}\nVideo id: {video_id}"
    try:
        with _ai_slots:
            response = _client.messages.parse(
                model=MODEL,
                max_tokens=1500,
                system=SYSTEM_REACT,
                output_config={"effort": "low"},
                messages=[{"role": "user", "content": prompt}],
                output_format=ReactionPlan,
            )
    except Exception as e:  # noqa: BLE001
        log.warning("react failed: %s", e)
        return None
    if getattr(response, "stop_reason", "") == "refusal":
        return None
    parsed = getattr(response, "parsed_output", None)
    if parsed is None:
        return None
    plan = parsed.model_dump()
    plan["mood"] = plan.get("mood", "curious").lower().strip()
    return plan


MOOD_WORDS = {
    "hungry": ["food", "fruit", "banana", "apple", "sugar", "cake", "cook", "recipe", "eat", "juice", "wine", "beer", "honey", "mango", "pizza", "sweet", "dessert", "kitchen", "meal", "snack", "candy", "chocolate"],
    "scared": ["spider", "swat", "predator", "horror", "scary", "trap", "kill", "poison", "insecticide", "frog", "bird", "wasp", "danger", "scream", "jump scare", "storm", "thunder", "fire", "explosion", "attack"],
    "groovy": ["music", "song", "dance", "beat", "remix", "dj", "concert", "live", "bass", "guitar", "piano", "drum", "rap", "pop", "edm", "techno", "jazz", "sing", "karaoke", "lofi"],
    "sleepy": ["sleep", "asmr", "rain", "calm", "relax", "meditat", "ambient", "slow", "night", "bedtime", "lullaby", "quiet", "nap", "cozy"],
    "excited": ["fast", "race", "crazy", "insane", "epic", "win", "goal", "highlight", "funny", "prank", "lol", "wow", "amazing", "compilation", "cat", "dog", "puppy", "kitten"],
}


def programmatic_plan(title: str, author: str = "") -> dict[str, Any]:
    text = f"{title} {author}".lower()
    mood = "curious"
    best = 0
    for m, words in MOOD_WORDS.items():
        n = sum(1 for w in words if w in text)
        if n > best:
            best, mood = n, m
    beats = {
        "curious": [(2, "look", "The fly turns to face the screen and studies it."),
                    (12, "antenna", "Its antennae twitch, sampling the air for clues."),
                    (25, "walk", "It takes a few steps closer, curious."),
                    (45, "think", "Something familiar lights up its memory centre."),
                    (70, "look", "It settles down and keeps watching.")],
        "hungry": [(2, "look", "The fly notices the food and locks on."),
                   (8, "feed", "Its proboscis extends, tasting the air."),
                   (20, "walk", "It hurries toward the screen."),
                   (35, "feed", "More tasting; the taste centre is buzzing."),
                   (60, "groove", "A happy wiggle: this looks delicious."),
                   (80, "feed", "One more taste before it calms down.")],
        "scared": [(2, "look", "The fly freezes and stares."),
                   (6, "startle", "It jumps! Something on screen looks dangerous."),
                   (12, "fly", "Escape flight: wings beating hard."),
                   (30, "walk", "It creeps back to look again."),
                   (50, "startle", "Another scare sends it backwards."),
                   (75, "rest", "Finally it settles, still alert.")],
        "groovy": [(2, "look", "The fly turns toward the music."),
                   (6, "groove", "Head bobbing to the beat."),
                   (20, "fly", "It lifts off for a spin."),
                   (35, "groove", "Back down and grooving again."),
                   (60, "walk", "A little dance-walk in circles."),
                   (85, "groove", "Still moving to the rhythm.")],
        "sleepy": [(2, "look", "The fly watches quietly."),
                   (15, "rest", "Its movements slow down."),
                   (40, "antenna", "A lazy antenna twitch."),
                   (70, "rest", "Almost dozing off.")],
        "excited": [(2, "look", "The fly snaps to attention."),
                    (6, "startle", "It hops with excitement."),
                    (15, "walk", "Quick steps toward the action."),
                    (30, "fly", "It takes off in a burst."),
                    (50, "groove", "Buzzing happily."),
                    (75, "walk", "Still pacing, wide awake.")],
    }[mood]
    summary = {
        "curious": "This looks interesting. The fly will watch closely and use its memory and smell centres to figure it out.",
        "hungry": "This looks like food! Expect the fly's taste and smell centres to light up as it tries to reach the screen.",
        "scared": "Something here looks dangerous to a fly. Expect startles and a quick escape flight.",
        "groovy": "Music! The fly will bob its head and buzz along with the beat.",
        "sleepy": "A calm one. The fly will slow down and relax while it watches.",
        "excited": "Lots of action here. The fly will hop, pace and buzz around.",
    }[mood]
    return {"mood": mood, "summary": summary, "beats": [{"at_s": t, "action": a, "note": n} for t, a, n in beats]}


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


@app.post("/api/react")
def react(req: ReactRequest) -> dict[str, Any]:
    vid = req.id.strip()
    title = req.title.strip()
    author = req.author.strip()
    if vid and not YT_ID_RE.match(vid):
        raise HTTPException(400, "invalid video id")
    if not title and vid:
        title = youtube(vid).get("title", "")
    key = vid or title
    with _lock:
        cached = _react_cache.get(key)
    if cached:
        return cached
    plan = call_react(vid, title, author) if ai_enabled() else None
    ai = plan is not None
    if plan is None:
        plan = programmatic_plan(title, author)
    plan["ai"] = ai
    plan["title"] = title
    with _lock:
        if len(_react_cache) > 2000:
            _react_cache.clear()
        _react_cache[key] = plan
    return plan
