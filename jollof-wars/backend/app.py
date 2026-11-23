"""Jollof Wars API.

Endpoints
  GET  /api/health           liveness check
  GET  /api/results          totals, % split, top countries, last-24h hourly votes
  GET  /api/me?voter=<id>    your current vote
  POST /api/vote             {"side": "ng|gh|peace", "country": "NG", "voter": "<uuid>"}
  GET  /api/stream           Server-Sent Events: pushes results whenever a vote lands

Run locally:  uvicorn app:app --reload --port 8000
"""
import asyncio
import hashlib
import json
import os
import re

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from db import SIDES, VoteStore
from ratelimit import TokenBucket

DB_PATH = os.getenv("DB_PATH", "jollof.db")
SALT = os.getenv("IP_SALT", "change-me-in-production")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

store = VoteStore(DB_PATH, max_voters_per_ip_per_day=int(os.getenv("MAX_VOTERS_PER_IP", "5")))
vote_limiter = TokenBucket(capacity=5, refill_per_sec=5 / 60)  # 5 votes/min burst per IP
read_limiter = TokenBucket(capacity=60, refill_per_sec=1)  # 60 reads burst, 1/sec sustained

VOTER_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
COUNTRY_RE = re.compile(r"^[A-Z]{2}$")


def client_ip(request: Request) -> str:
    # Behind Render/Railway/Fly the real IP is the first entry in X-Forwarded-For
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def ip_hash(request: Request) -> str:
    # We never store raw IPs, only a salted hash
    return hashlib.sha256((SALT + client_ip(request)).encode()).hexdigest()[:32]


def too_many(retry_after: float) -> JSONResponse:
    return JSONResponse(
        {"error": "slow down", "retry_after": round(retry_after, 1)},
        status_code=429,
        headers={"Retry-After": str(max(1, int(retry_after)))},
    )


async def health(request: Request):
    return JSONResponse({"ok": True})


async def results(request: Request):
    ok, wait = read_limiter.allow(ip_hash(request))
    if not ok:
        return too_many(wait)
    return JSONResponse(store.results())


async def me(request: Request):
    voter = request.query_params.get("voter", "")
    if not VOTER_RE.match(voter):
        return JSONResponse({"error": "invalid voter id"}, status_code=400)
    return JSONResponse({"vote": store.my_vote(voter)})


async def vote(request: Request):
    key = ip_hash(request)
    ok, wait = vote_limiter.allow(key)
    if not ok:
        return too_many(wait)

    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return JSONResponse({"error": "body must be JSON"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "body must be an object"}, status_code=400)

    side = body.get("side")
    country = str(body.get("country", "")).upper()
    voter = str(body.get("voter", ""))

    errors = {}
    if side not in SIDES:
        errors["side"] = f"must be one of {', '.join(SIDES)}"
    if not COUNTRY_RE.match(country):
        errors["country"] = "must be a 2-letter country code"
    if not VOTER_RE.match(voter):
        errors["voter"] = "must be 8-64 letters, numbers or dashes"
    if errors:
        return JSONResponse({"error": "validation failed", "fields": errors}, status_code=422)

    status = store.cast(voter, key, side, country)
    if status == "ip_limit":
        return JSONResponse({"error": "too many voters from this network today"}, status_code=429)
    return JSONResponse({"status": status, "results": store.results()}, status_code=201 if status == "created" else 200)


async def stream(request: Request):
    """Server-Sent Events: send results now, then again whenever the vote version changes."""

    async def events():
        last = None
        idle = 0
        while not await request.is_disconnected():
            if store.version != last:
                last = store.version
                idle = 0
                yield f"event: results\ndata: {json.dumps(store.results())}\n\n"
            else:
                idle += 1
                if idle % 15 == 0:
                    yield ": keep-alive\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app = Starlette(
    routes=[
        Route("/api/health", health),
        Route("/api/results", results),
        Route("/api/me", me),
        Route("/api/vote", vote, methods=["POST"]),
        Route("/api/stream", stream),
    ],
    middleware=[
        Middleware(
            CORSMiddleware,
            allow_origins=ALLOWED_ORIGINS,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
        )
    ],
)
