"""Turns raw history + catalog into the single JSON file the dashboard reads."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from insights import enrich


def norm_date(d: str | None) -> str:
    """Spotify release dates can be '2025', '2025-06' or '2025-06-06'."""
    if not d:
        return "1900-01-01"
    parts = d.split("-") + ["01", "01"]
    return "-".join([parts[0], parts[1].zfill(2), parts[2].zfill(2)])


def _value_on_or_before(history: dict, dates: list[str], aid: str, key: str, target: str):
    """Most recent non-null value for an artist on or before a date, plus that date."""
    for d in reversed(dates):
        if d <= target:
            v = history[d].get(aid, {}).get(key)
            if v is not None:
                return v, d
    return None, None


def pct(new, old):
    if new is None or old in (None, 0):
        return None
    return round(100 * (new - old) / old, 1)


def song_stats(history, dates, aid, week_ago):
    """Per-song numbers for one artist: {track_id: {title, total, daily, feature, change, gained}}."""
    if not dates:
        return {}
    latest = history[dates[-1]].get(aid, {}).get("tracks", {})
    then_date = max((d for d in dates if d <= week_ago), default=dates[0])
    before = history[then_date].get(aid, {}).get("tracks", {}) if then_date != dates[-1] else {}
    out = {}
    for tid, rec in latest.items():
        title, total, daily = rec[0], rec[1], rec[2]
        feature = bool(rec[3]) if len(rec) > 3 else False
        old = before.get(tid)
        out[tid] = {"id": tid, "title": title, "total": total, "daily": daily, "feature": feature,
                    "change": pct(daily, old[2]) if old else None,
                    "gained": (total - old[1]) if old else None,
                    "since": then_date if old else None}
    return out


def songs_block(aid, stats, catalog, albums):
    """Latest release + most-streamed songs + biggest features for the artist detail view."""
    releases = sorted(catalog.get(aid, {}).get("releases", []), key=lambda r: norm_date(r.get("date")), reverse=True)
    latest = None
    if releases:
        r = releases[0]
        tracks = []
        for t in albums.get(r["id"], []):
            s = stats.get(t["id"])
            tracks.append(s if s else {"id": t["id"], "title": t["name"], "total": None, "daily": None, "change": None})
        charting = [t for t in tracks if t.get("total") is not None]
        latest = {"name": r["name"], "type": r.get("type"), "date": norm_date(r.get("date")), "id": r["id"],
                  "tracks": tracks[:12], "charting": bool(charting),
                  "daily": sum(t["daily"] or 0 for t in charting) or None,
                  "total": sum(t["total"] or 0 for t in charting) or None}
    own = sorted([s for s in stats.values() if not s["feature"]], key=lambda s: -s["total"])[:5]
    feats = sorted([s for s in stats.values() if s["feature"]], key=lambda s: -s["total"])[:3]
    return {"latest": latest, "top": own, "features": feats, "charting": bool(stats)}


def build(history: dict, catalog: dict, artists: list[dict], today: str | None = None, albums: dict | None = None) -> dict:
    albums = albums or {}
    dates = sorted(history)
    today = today or (dates[-1] if dates else date.today().isoformat())
    week_ago = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
    tracked = {a["spotify_id"]: a for a in artists if a.get("spotify_id")}
    group_of = {aid: a["group"] for aid, a in tracked.items()}

    # ---------- per-artist stats ----------
    rows = []
    for aid, a in tracked.items():
        lis, lis_d = _value_on_or_before(history, dates, aid, "listeners", today)
        lis_then, then_d = _value_on_or_before(history, dates, aid, "listeners", week_ago)
        if lis_then is None:  # fewer than 7 days of data: compare with the first day we have
            first = next((d for d in dates if history[d].get(aid, {}).get("listeners") is not None), None)
            lis_then, then_d = (history[first][aid]["listeners"], first) if first and first != lis_d else (None, None)
        daily, _ = _value_on_or_before(history, dates, aid, "daily", today)
        daily_then, _ = _value_on_or_before(history, dates, aid, "daily", week_ago)
        streams, _ = _value_on_or_before(history, dates, aid, "streams", today)
        gained = (lis - lis_then) if (lis is not None and lis_then is not None) else None
        span = (date.fromisoformat(lis_d) - date.fromisoformat(then_d)).days if (gained is not None and lis_d and then_d) else None
        rows.append({
            "songs": songs_block(aid, song_stats(history, dates, aid, week_ago), catalog, albums),
            "id": aid, "name": a["name"], "group": a["group"], "image": a.get("image"),
            "listeners": lis, "listenersChange": pct(lis, lis_then), "changeSince": then_d,
            "listenersGained": gained, "changeDays": span,
            "gainedPerDay": round(gained / span) if gained is not None and span else None,
            "dailyStreams": daily, "dailyChange": pct(daily, daily_then), "totalStreams": streams,
            "series": [[d, history[d].get(aid, {}).get("listeners"), history[d].get(aid, {}).get("daily")] for d in dates
                       if aid in history[d]],
        })
    rows.sort(key=lambda r: -(r["listeners"] or 0))

    # ---------- groups over time ----------
    groups = sorted(set(group_of.values()))
    group_series = []
    for d in dates:
        point = {"date": d}
        for g in groups:
            vals = [history[d][aid].get("daily") for aid in history[d] if group_of.get(aid) == g]
            vals = [v for v in vals if v is not None]
            point[g] = sum(vals) if vals else None
            lis_vals = [history[d][aid].get("listeners") for aid in history[d] if group_of.get(aid) == g]
            lis_vals = [v for v in lis_vals if v is not None]
            point[g + "Listeners"] = sum(lis_vals) if lis_vals else None
        group_series.append(point)

    # ---------- climbing tracks ----------
    climbers = []
    if dates:
        latest = history[dates[-1]]
        then_date = max((d for d in dates if d <= week_ago), default=dates[0])
        for aid, snap in latest.items():
            if aid not in tracked:
                continue
            before = history[then_date].get(aid, {}).get("tracks", {})
            for tid, (title, total, daily, *_) in snap.get("tracks", {}).items():
                old = before.get(tid)
                climbers.append({
                    "track": title, "id": tid, "artist": tracked[aid]["name"], "group": tracked[aid]["group"],
                    "daily": daily, "total": total,
                    "change": pct(daily, old[2]) if old else None, "new": old is None and then_date != dates[-1],
                })
        climbers = [c for c in climbers if c["daily"] >= 500]
        climbers.sort(key=lambda c: (c["change"] is None, -(c["change"] or 0), -c["daily"]))
        climbers = climbers[:15]

    # ---------- collaboration network ----------
    names, edges, first_seen = {}, defaultdict(lambda: {"tracks": set(), "first": None, "example": None}), {}
    for aid, entry in catalog.items():
        for c in entry.get("collabs", []):
            people = [p for p in c["with"] if p["id"] != aid] + [{"id": aid, "name": tracked.get(aid, {}).get("name", aid)}]
            for p in people:
                names[p["id"]] = p["name"]
            for p in people:
                if p["id"] == aid:
                    continue
                key = tuple(sorted((aid, p["id"])))
                e = edges[key]
                e["tracks"].add(c["track_id"])
                d = norm_date(c.get("date"))
                if e["first"] is None or d < e["first"]:
                    e["first"], e["example"] = d, c["track"]

    # keep untracked people only if they link to 2+ tracked artists or 2+ tracks
    links_to_tracked = defaultdict(set)
    for (a, b), e in edges.items():
        if a in tracked and b not in tracked:
            links_to_tracked[b].add(a)
        if b in tracked and a not in tracked:
            links_to_tracked[a].add(b)
    keep = set(tracked)
    for pid, linked in links_to_tracked.items():
        weight = sum(len(e["tracks"]) for k, e in edges.items() if pid in k)
        if len(linked) >= 2 or weight >= 2:
            keep.add(pid)
    net_edges = [{"a": a, "b": b, "weight": len(e["tracks"]), "first": e["first"], "example": e["example"]}
                 for (a, b), e in edges.items() if a in keep and b in keep]
    net_nodes = [{"id": n, "name": names.get(n) or tracked.get(n, {}).get("name", n), "group": group_of.get(n, "other")}
                 for n in keep if any(n in (e["a"], e["b"]) for e in net_edges)]

    # ---------- crossovers: first time a UG artist worked with a mainstream one ----------
    crossovers = []
    for e in net_edges:
        ga, gb = group_of.get(e["a"]), group_of.get(e["b"])
        if {ga, gb} == {"UG", "mainstream"}:
            ug, ms = (e["a"], e["b"]) if ga == "UG" else (e["b"], e["a"])
            crossovers.append({"ug": tracked[ug]["name"], "mainstream": tracked[ms]["name"], "date": e["first"],
                               "track": e["example"], "tracks": e["weight"]})
    crossovers.sort(key=lambda c: c["date"], reverse=True)

    # ---------- names to watch: untracked artists showing up with UG acts lately ----------
    cutoff = (date.fromisoformat(today) - timedelta(days=548)).isoformat()
    watch = defaultdict(lambda: {"with": set(), "tracks": set(), "latest": "1900-01-01"})
    for aid, entry in catalog.items():
        if group_of.get(aid) != "UG":
            continue
        for c in entry.get("collabs", []):
            d = norm_date(c.get("date"))
            if d < cutoff:
                continue
            for p in c["with"]:
                if p["id"] in tracked or p["id"] == aid:
                    continue
                w = watch[p["id"]]
                w["name"] = p["name"]
                w["with"].add(tracked[aid]["name"])
                w["tracks"].add(c["track_id"])
                w["latest"] = max(w["latest"], d)
    names_to_watch = sorted(
        ({"id": k, "name": v["name"], "with": sorted(v["with"]), "tracks": len(v["tracks"]), "latest": v["latest"]}
         for k, v in watch.items() if len(v["tracks"]) >= 2),
        key=lambda x: (-len(x["with"]), -x["tracks"], x["name"]),
    )[:12]

    # ---------- fresh releases ----------
    releases = []
    for aid, entry in catalog.items():
        if aid not in tracked:
            continue
        for r in entry.get("releases", []):
            releases.append({"artist": tracked[aid]["name"], "group": tracked[aid]["group"], "name": r["name"],
                             "type": r.get("type"), "date": norm_date(r.get("date")), "id": r["id"]})
    releases.sort(key=lambda r: r["date"], reverse=True)

    return enrich({
        "updated": today,
        "days": len(dates),
        "firstDay": dates[0] if dates else None,
        "groups": groups,
        "artists": rows,
        "groupSeries": group_series,
        "climbers": climbers,
        "network": {"nodes": net_nodes, "edges": net_edges},
        "crossovers": crossovers[:20],
        "namesToWatch": names_to_watch,
        "releases": releases[:24],
    })
