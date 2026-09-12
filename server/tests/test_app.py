import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

import app as srv  # noqa: E402

client = TestClient(srv.app)


def test_health_without_key():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["ai"] == srv.ai_enabled()


def test_youtube_rejects_bad_id():
    assert client.get("/api/youtube", params={"id": "bad id!"}).status_code == 400


def test_narrate_without_ai_and_rate_limit(monkeypatch):
    monkeypatch.setattr(srv, "_client", None)
    srv._last_narrate.clear()
    r = client.post("/api/narrate", json={"state": {"behaviour": "walk"}})
    assert r.status_code == 200 and r.json() == {"text": "", "ai": False}
    r2 = client.post("/api/narrate", json={"state": {"behaviour": "walk"}})
    assert r2.status_code == 429


def test_narrate_uses_claude_text(monkeypatch):
    class Block:
        type = "text"
        text = "The fly is walking. Its central complex is steering."

    class Resp:
        stop_reason = "end_turn"
        content = [Block()]

    class Msgs:
        def create(self, **kw):
            assert kw["model"] == srv.MODEL
            assert kw["fallbacks"] == "default"
            return Resp()

    class Beta:
        messages = Msgs()

    class Fake:
        beta = Beta()

    monkeypatch.setattr(srv, "_client", Fake())
    srv._last_narrate.clear()
    r = client.post("/api/narrate", json={"state": {"behaviour": "walk"}})
    assert r.json()["ai"] is True
    assert "walking" in r.json()["text"]
