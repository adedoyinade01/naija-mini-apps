"""
The weekly Motion Report: top movers, songs of the week, new drops, meter moves, names to watch,
and a ready-to-post X thread. collect.py archives one every Friday; the dashboard also shows
"this week so far" on other days.
"""
from __future__ import annotations

from datetime import date, timedelta

from insights import fmt, nice_date

MIN_LISTENERS = 10_000


def _label(score: int) -> str:
    return "Crossed over" if score >= 75 else "Breaking through" if score >= 40 else "Underground"


def weekly_report(history: dict, out: dict, end: str | None = None) -> dict | None:
    dates = sorted(history)
    if len(dates) < 2:
        return None
    end = end or dates[-1]
    start_limit = (date.fromisoformat(end) - timedelta(days=7)).isoformat()
    window = [d for d in dates if start_limit <= d <= end]
    if len(window) < 2:
        return None
    start = window[0]
    rows = {r["id"]: r for r in out["artists"]}
    h0, h1 = history[start], history[end]

    # ---------- top movers ----------
    movers = []
    for aid, r in rows.items():
        a, b = h0.get(aid, {}).get("listeners"), h1.get(aid, {}).get("listeners")
        if a and b and b >= MIN_LISTENERS:
            movers.append({"name": r["name"], "group": r["group"], "from": a, "to": b, "gained": b - a,
                           "change": round(100 * (b - a) / a, 1), "driver": r.get("driver")})
    movers.sort(key=lambda m: -m["change"])
    top = [m for m in movers if m["change"] > 0][:5]
    biggest_gain = max(movers, key=lambda m: m["gained"], default=None)

    # ---------- songs of the week ----------
    songs = []
    for aid, r in rows.items():
        t0, t1 = h0.get(aid, {}).get("tracks", {}), h1.get(aid, {}).get("tracks", {})
        for tid, rec in t1.items():
            if tid in t0:
                gained = rec[1] - t0[tid][1]
                if gained > 0:
                    songs.append({"title": rec[0], "artist": r["name"], "group": r["group"], "gained": gained, "daily": rec[2]})
    songs.sort(key=lambda s: -s["gained"])
    songs = songs[:5]

    # ---------- new drops this week ----------
    drops = []
    for aid, r in rows.items():
        latest = (r.get("songs") or {}).get("latest")
        if latest and start <= latest["date"] <= end:
            drops.append({"artist": r["name"], "group": r["group"], "name": latest["name"], "type": latest.get("type"),
                          "date": latest["date"], "plays": latest.get("total"), "daily": latest.get("daily")})
    drops.sort(key=lambda d: d["date"], reverse=True)

    # ---------- meter moves ----------
    ms0 = [h0.get(aid, {}).get("listeners") for aid, r in rows.items() if r["group"] == "mainstream"]
    floor_then = min([v for v in ms0 if v], default=None)
    moves = []
    for aid, r in rows.items():
        m = r.get("meter")
        lis0 = h0.get(aid, {}).get("listeners")
        if not m or not lis0 or not floor_then:
            continue
        score0 = round(50 * min(1.0, lis0 / floor_then)) + m["parts"]["features"] + (20 if h0.get(aid, {}).get("daily") else 0)
        if _label(score0) != m["label"]:
            moves.append({"name": r["name"], "from": _label(score0), "to": m["label"]})

    watch = (out.get("namesToWatch") or [])[:3]
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days
    title = f"Motion Report · {nice_date(start)} – {nice_date(end)}"
    note = None if days >= 6 else f"Covers {days} day{'s' if days != 1 else ''} (tracking started {nice_date(dates[0])})."

    # ---------- the X thread ----------
    thread = [f"MOTION REPORT 📈 {nice_date(start).lower()} – {nice_date(end).lower()}\n\nwho moved in naija music this week, measured daily on spotify 🧵"]
    if top:
        lines = [f"{i}. {m['name']} +{m['change']}% (+{fmt(m['gained'])})" for i, m in enumerate(top, 1)]
        thread.append("top movers this week:\n\n" + "\n".join(lines))
    if songs:
        lines = [f"• \"{s['title']}\" by {s['artist']}: +{fmt(s['gained'])} plays" for s in songs[:4]]
        thread.append("songs of the week:\n\n" + "\n".join(lines))
    if drops:
        lines = [f"• {d['artist']}: \"{d['name']}\" ({d.get('type') or 'release'})" + (f", {fmt(d['plays'])} plays already" if d.get("plays") else "") for d in drops[:4]]
        thread.append("new drops:\n\n" + "\n".join(lines))
    if moves:
        lines = [f"• {m['name']}: {m['from'].lower()} → {m['to'].lower()}" for m in moves]
        thread.append("UG → mainstream meter moves:\n\n" + "\n".join(lines))
    if watch:
        w = watch[0]
        thread.append(f"name to watch 👀 {w['name']}: on {w['tracks']} songs with {len(w['with'])} UG acts and nobody's talking about it")
    thread.append("full numbers, every artist, updated every morning 👇")

    return {"title": title, "start": start, "end": end, "days": days, "note": note, "topMovers": top,
            "biggestGain": biggest_gain, "songs": songs, "drops": drops, "meterMoves": moves, "watch": watch,
            "thread": thread}
