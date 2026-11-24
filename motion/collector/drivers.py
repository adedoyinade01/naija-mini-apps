"""
What's driving each artist's motion, and the new-music spotlight.

driver:    the song behind today's move. Certain when we have per-song plays (kworb);
           "likely" when we only know they dropped something recently.
spotlight: top movers who have a new release (last 30 days): every track, how much of their
           plays the new release accounts for, and how their listeners moved since it dropped.
"""
from __future__ import annotations

from datetime import date

RECENT_DAYS = 30
LIKELY_DAYS = 21


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def song_deltas(history: dict, dates: list[str], aid: str) -> list[dict]:
    """Day-over-day change in daily plays for each song (latest day vs the day before)."""
    if len(dates) < 2:
        return []
    now = history[dates[-1]].get(aid, {}).get("tracks", {})
    prev = history[dates[-2]].get(aid, {}).get("tracks", {})
    out = []
    for tid, rec in now.items():
        title, total, daily = rec[0], rec[1], rec[2]
        old = prev.get(tid)
        if old:
            delta = daily - old[2]
            out.append({"id": tid, "title": title, "daily": daily, "delta": delta,
                        "change": round(100 * delta / old[2], 1) if old[2] else None, "new": False})
        elif daily:
            out.append({"id": tid, "title": title, "daily": daily, "delta": daily, "change": None, "new": True})
    return out


def driver_for(row: dict, deltas: list[dict], today: str) -> dict | None:
    if row["status"]["key"] not in ("rising", "growing"):
        return None
    latest = (row.get("songs") or {}).get("latest")
    recent_ids = {t["id"] for t in latest["tracks"]} if latest and _days(latest["date"], today) <= RECENT_DAYS else set()
    up = [d for d in deltas if d["delta"] > 0]
    if up:
        best = max(up, key=lambda d: d["delta"])
        return {"kind": "song", "title": best["title"], "change": best["change"], "delta": best["delta"], "new": best["new"],
                "fromRelease": latest["name"] if best["id"] in recent_ids else None}
    if latest and 0 <= _days(latest["date"], today) <= LIKELY_DAYS:
        return {"kind": "likely", "title": latest["name"], "type": latest.get("type"), "date": latest["date"]}
    return None


def listeners_on(history: dict, dates: list[str], aid: str, day: str):
    """Listeners on or just before a day (first tracked day if the day is before tracking started)."""
    cands = [d for d in dates if d <= day and history[d].get(aid, {}).get("listeners") is not None]
    if cands:
        return history[cands[-1]][aid]["listeners"], cands[-1], False
    first = next((d for d in dates if history[d].get(aid, {}).get("listeners") is not None), None)
    return (history[first][aid]["listeners"], first, True) if first else (None, None, False)


def spotlight(rows: list[dict], history: dict, dates: list[str], today: str, limit: int = 3) -> list[dict]:
    cands = []
    for r in rows:
        latest = (r.get("songs") or {}).get("latest")
        if not latest or r["status"]["key"] not in ("rising", "growing"):
            continue
        age = _days(latest["date"], today)
        if not 0 <= age <= RECENT_DAYS or (r.get("listeners") or 0) < 10_000:
            continue
        base, base_day, before_tracking = listeners_on(history, dates, r["id"], latest["date"])
        gained = (r["listeners"] - base) if base is not None and r.get("listeners") is not None else None
        share = min(100, round(100 * latest["daily"] / r["dailyStreams"])) if latest.get("daily") and r.get("dailyStreams") else None
        today_moves = {d["id"]: d for d in song_deltas(history, dates, r["id"])}
        tracks = [{**t, "today": today_moves.get(t["id"], {}).get("change"), "todayDelta": today_moves.get(t["id"], {}).get("delta")}
                  for t in latest["tracks"]]
        top_track = max((t for t in latest["tracks"] if t.get("daily")), key=lambda t: t["daily"], default=None)
        lines = []
        if share is not None:
            lines.append(f"{share}% of {r['name']}'s daily plays now come from \"{latest['name']}\"")
        if top_track and len(latest["tracks"]) > 1:
            lines.append(f"Standout track: \"{top_track['title']}\" with {fmt(top_track['daily'])} plays a day")
        if gained is not None and base_day:
            since = "since we started tracking" if before_tracking else f"since it dropped"
            if gained > 0:
                lines.append(f"+{fmt(gained)} monthly listeners {since} ({fmt(base)} → {fmt(r['listeners'])})")
            elif gained == 0:
                lines.append(f"Listeners holding at {fmt(r['listeners'])} {since}")
        if not latest.get("charting"):
            lines.append("Song streams aren't public yet, so we track the listener growth around the drop")
        cands.append({"id": r["id"], "artist": r["name"], "group": r["group"], "image": r.get("image"),
                      "release": {k: latest[k] for k in ("name", "type", "date", "daily", "total", "charting", "id")},
                      "daysOut": age, "tracks": tracks, "share": share, "gainedSinceDrop": gained,
                      "beforeTracking": before_tracking, "listenersChange": r.get("listenersChange"), "lines": lines})
    cands.sort(key=lambda c: -(c["listenersChange"] or 0))
    return cands[:limit]


def fmt(n) -> str:
    from insights import fmt as _fmt
    return _fmt(n)
