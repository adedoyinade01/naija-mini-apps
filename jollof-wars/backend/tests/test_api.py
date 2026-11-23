"""End-to-end: boots the real server on a free port and talks HTTP to it."""
import importlib
import json
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest
import uvicorn


@pytest.fixture(scope="module")
def base_url(tmp_path_factory, monkeypatch_module=None):
    import os
    os.environ["DB_PATH"] = str(tmp_path_factory.mktemp("db") / "api.db")
    os.environ["MAX_VOTERS_PER_IP"] = "100"
    sys.modules.pop("app", None)
    app = importlib.import_module("app").app

    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True); t.start()
    for _ in range(50):
        if server.started: break
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True


def call(url, data=None, ip="1.1.1.1"):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", "X-Forwarded-For": ip})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health(base_url):
    assert call(base_url + "/api/health") == (200, {"ok": True})


def test_vote_flow(base_url):
    code, body = call(base_url + "/api/vote", {"side": "ng", "country": "ng", "voter": "abc-12345"})
    assert code == 201 and body["results"]["totals"]["ng"] == 1
    code, body = call(base_url + "/api/vote", {"side": "gh", "country": "NG", "voter": "abc-12345"})
    assert code == 200 and body["status"] == "changed"
    assert call(base_url + "/api/me?voter=abc-12345")[1]["vote"] == {"side": "gh", "country": "NG"}


def test_validation(base_url):
    code, body = call(base_url + "/api/vote", {"side": "rice", "country": "Nigeria", "voter": "x"}, ip="2.2.2.2")
    assert code == 422 and set(body["fields"]) == {"side", "country", "voter"}


def test_rate_limit(base_url):
    codes = [call(base_url + "/api/vote", {"side": "ng", "country": "NG", "voter": f"spam-{i:05d}"}, ip="9.9.9.9")[0]
             for i in range(7)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


def test_stream_sends_results(base_url):
    with urllib.request.urlopen(base_url + "/api/stream", timeout=5) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        first = r.readline().decode()
        data = r.readline().decode()
    assert first.startswith("event: results")
    assert json.loads(data[len("data: "):])["total"] >= 1
