"""
MOTION: the plain-English layer: turns the numbers into things anyone can read.

Adds to the dashboard data:
  - a status word per artist (rising fast / growing / steady / dipping) and a one-line summary
  - comparisons ("about as many listeners as ODUMODUBLVCK")
  - a UG -> Mainstream meter for every UG act, with the evidence behind the score
  - "Still UG?" debate cards for UG acts the numbers say have crossed over
  - "Today's story": a few sentences written from the data
"""
from __future__ import annotations

from datetime import date

MIN_LISTENERS_FOR_HEADLINES = 10_000  # ignore tiny profiles where +5 people = +20%


def fmt(n) -> str:
    if n is None:
        return "–"
    a, sign = abs(n), "-" if n < 0 else ""
    if a >= 1e6:
        return f"{sign}{a / 1e6:.1f}M".replace(".0M", "M")
    if a >= 1e4:
        return f"{sign}{a / 1e3:.0f}K"
    if a >= 1e3:
        return f"{sign}{a / 1e3:.1f}K".replace(".0K", "K")
    return f"{sign}{int(a)}"


def nice_date(iso: str | None) -> str:
    if not iso:
        return ""
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


def status_of(row: dict) -> dict:
    p = row.get("listenersChange")
    if p is None:
        return {"key": "new", "label": "New", "icon": "•", "text": "tracking started"}
    if p >= 2:
        return {"key": "rising", "label": "In Motion", "icon": "🚀", "text": "in motion"}
    if p > 0:
        return {"key": "growing", "label": "Moving", "icon": "▲", "text": "moving"}
    if p <= -2:
        return {"key": "falling", "label": "Slowing", "icon": "▼", "text": "slowing down"}
    if p < 0:
        return {"key": "dipping", "label": "Slowing", "icon": "▼", "text": "slowing slightly"}
    return {"key": "steady", "label": "Still", "icon": "●", "text": "holding still"}


def collaborators(out: dict) -> dict:
    """{artist_id: [{id, name, group, songs, first}]} from the network edges."""
    names = {n["id"]: n for n in out["network"]["nodes"]}
    by = {}
    for e in out["network"]["edges"]:
        for me, other in ((e["a"], e["b"]), (e["b"], e["a"])):
            o = names.get(other, {"name": other, "group": "other"})
            by.setdefault(me, []).append({"id": other, "name": o["name"], "group": o["group"],
                                          "songs": e["weight"], "first": e["first"], "example": e["example"]})
    for v in by.values():
        v.sort(key=lambda c: (-c["songs"], c["name"]))
    return by


def comparison(row: dict, rows: list[dict]) -> str | None:
    lis = row.get("listeners")
    if not lis:
        return None
    if row["group"] == "UG":
        ms = sorted([r for r in rows if r["group"] == "mainstream" and r.get("listeners")], key=lambda r: r["listeners"])
        if not ms:
            return None
        near = min(ms, key=lambda r: abs(r["listeners"] - lis))
        if 0.92 <= lis / near["listeners"] <= 1.08:
            return f"about as many listeners as {near['name']}"
        below = [r for r in ms if r["listeners"] < lis]
        if below:
            return f"more listeners than {below[-1]['name']}"
        smallest = ms[0]
        share = lis / smallest["listeners"]
        if share >= 0.5:
            return f"over half of {smallest['name']}'s audience"
        if share >= 0.15:
            return f"about 1/{round(1 / share)} of {smallest['name']}'s audience"
        # small acts: measure them against the next UG artist above them
        bigger_ug = sorted([r for r in rows if r["group"] == "UG" and (r.get("listeners") or 0) > lis], key=lambda r: r["listeners"])
        if bigger_ug:
            nxt = bigger_ug[0]
            if nxt["listeners"] / lis <= 1.08:
                return f"neck and neck with {nxt['name']}"
            return f"{fmt(nxt['listeners'] - lis)} listeners behind {nxt['name']}"
        return f"about 1/{round(1 / share)} of {smallest['name']}'s audience"
    ranked = sorted([r for r in rows if r.get("listeners")], key=lambda r: -r["listeners"])
    pos = next(i for i, r in enumerate(ranked) if r["id"] == row["id"]) + 1
    return f"#{pos} of {len(ranked)} artists we track"


def meter(row: dict, collabs: list[dict], floor: int | None) -> dict | None:
    """UG -> Mainstream meter, 0-100, with the evidence behind it."""
    if row["group"] != "UG":
        return None
    lis = row.get("listeners") or 0
    ms_collabs = [c for c in collabs if c["group"] == "mainstream"]
    reach = min(1.0, lis / floor) if floor else 0
    score = round(50 * reach + 30 * min(3, len(ms_collabs)) / 3 + (20 if row.get("dailyStreams") else 0))
    label = "Crossed over" if score >= 75 else "Breaking through" if score >= 40 else "Underground"
    evidence = [
        f"Reach: {fmt(lis)} listeners, {round(100 * reach)}% of the smallest mainstream act we track" if floor else None,
        (f"Features with mainstream stars: {', '.join(c['name'] for c in ms_collabs[:4])}" if ms_collabs
         else "No features with mainstream stars yet"),
        ("On Spotify's daily stream charts (kworb)" if row.get("dailyStreams") else "Not on the daily stream charts yet"),
    ]
    return {"score": score, "label": label, "evidence": [e for e in evidence if e],
            "parts": {"reach": round(50 * reach), "features": round(30 * min(3, len(ms_collabs)) / 3),
                      "charts": 20 if row.get("dailyStreams") else 0}}


def debate(row: dict, collabs: list[dict], comp: str | None) -> dict | None:
    m = row.get("meter")
    if not m or m["label"] != "Crossed over":
        return None
    ug = [c for c in collabs if c["group"] == "UG"]
    ms = [c for c in collabs if c["group"] == "mainstream"]
    still = []
    if ug:
        still.append(f"Still makes music with the scene: {', '.join(c['name'] for c in ug[:4])}")
    still.append("Came up through the UG scene, and the sound and the community haven't changed")
    if not row.get("dailyStreams"):
        still.append("Not on the daily stream charts yet")
    gone = [f"{fmt(row['listeners'])} monthly listeners, {comp}" if comp else f"{fmt(row['listeners'])} monthly listeners"]
    if ms:
        gone.append(f"Has songs with {', '.join(c['name'] for c in ms[:4])}")
    if row.get("dailyStreams"):
        gone.append(f"About {fmt(row['dailyStreams'])} Spotify streams a day")
    return {"question": f"Is {row['name']} still UG?", "still": still, "graduated": gone}


def summary(row: dict) -> str:
    s = row["status"]
    bits = [f"{fmt(row['listeners'])} monthly listeners"] if row.get("listeners") else ["No listener data yet"]
    if row.get("comparison"):
        bits.append(row["comparison"])
    if row.get("listenersGained") is not None and row.get("changeSince"):
        g = row["listenersGained"]
        if g == 0 or row["listenersChange"] == 0:
            bits.append(f"holding steady since {nice_date(row['changeSince'])}")
        else:
            bits.append(f"{'up' if g > 0 else 'down'} {abs(row['listenersChange'])}% since {nice_date(row['changeSince'])} "
                        f"({'+' if g > 0 else '-'}{fmt(abs(g))} listeners)")
    elif s["key"] == "new":
        bits.append("growth shows from the second day of tracking")
    return " · ".join(bits)


def story(out: dict) -> list[str]:
    rows = out["artists"]
    lines = []
    if out["days"] <= 1:
        lines.append(f"Tracking started on {nice_date(out['firstDay'])}. Growth shows from tomorrow, once there's a second day to compare.")
    moving = [r for r in rows if r.get("listenersChange") is not None and (r.get("listeners") or 0) >= MIN_LISTENERS_FOR_HEADLINES]
    since = next((r["changeSince"] for r in moving if r.get("changeSince")), None)
    period = "overnight" if out["days"] == 2 else f"since {nice_date(since)}"
    up = sorted([r for r in moving if r["listenersChange"] > 0], key=lambda r: -r["listenersChange"])
    if up:
        top = up[0]
        line = f"{top['name']} grew the most {period}: +{top['listenersChange']}% (about {fmt(top['listenersGained'])} new listeners)"
        d = top.get("driver")
        if d and d["kind"] == "song":
            line += f", driven by \"{d['title']}\"" + (f" (plays up {d['change']}% in a day)" if d.get("change") else "")
        elif d and d["kind"] == "likely":
            line += f", likely off their new {d.get('type') or 'release'} \"{d['title']}\" (out {nice_date(d['date'])})"
        line += "."
        if len(up) > 1:
            line += f" {up[1]['name']} was close behind at +{up[1]['listenersChange']}%."
        lines.append(line)
    down = sorted([r for r in moving if r["listenersChange"] < 0], key=lambda r: r["listenersChange"])
    if down and down[0]["listenersChange"] <= -1:
        lines.append(f"{down[0]['name']} dipped the most: {down[0]['listenersChange']}%.")
    ug = [r for r in rows if r["group"] == "UG" and r.get("listeners")]
    if ug:
        big = max(ug, key=lambda r: r["listeners"])
        lines.append(f"{big['name']} is the biggest UG act right now with {fmt(big['listeners'])} monthly listeners, {big.get('comparison') or ''}.".replace(", .", "."))
    crossed = [r["name"] for r in ug if r.get("meter") and r["meter"]["label"] == "Crossed over"]
    breaking = [r["name"] for r in ug if r.get("meter") and r["meter"]["label"] == "Breaking through"]
    if crossed:
        lines.append(f"By our meter, {', '.join(crossed)} {'has' if len(crossed) == 1 else 'have'} crossed over to mainstream-level numbers"
                     + (f", and {', '.join(breaking[:3])} {'is' if len(breaking[:3]) == 1 else 'are'} breaking through." if breaking else "."))
    if out.get("namesToWatch"):
        w = out["namesToWatch"][0]
        who = ", ".join(w["with"][:3]) + (f" and {len(w['with']) - 3} more" if len(w["with"]) > 3 else "")
        lines.append(f"Name to watch: {w['name']} keeps popping up on UG songs: {w['tracks']} tracks with {len(w['with'])} different acts ({who}). "
                     f"We're not tracking them yet, but the scene clearly rates them.")
    return lines


def enrich(out: dict, history: dict | None = None) -> dict:
    from drivers import driver_for, song_deltas, spotlight
    history = history or {}
    dates = sorted(history)
    rows = out["artists"]
    collabs = collaborators(out)
    ms_listeners = [r["listeners"] for r in rows if r["group"] == "mainstream" and r.get("listeners")]
    floor = min(ms_listeners) if ms_listeners else None
    for r in rows:
        r["status"] = status_of(r)
        r["comparison"] = comparison(r, rows)
        r["collaborators"] = collabs.get(r["id"], [])[:12]
        r["meter"] = meter(r, collabs.get(r["id"], []), floor)
        r["debate"] = debate(r, collabs.get(r["id"], []), r["comparison"])
        r["summary"] = summary(r)
        r["driver"] = driver_for(r, song_deltas(history, dates, r["id"]), out["updated"])
    out["mainstreamFloor"] = floor
    out["spotlight"] = spotlight(rows, history, dates, out["updated"])
    out["story"] = story(out)
    out["debates"] = [{"id": r["id"], "name": r["name"], **r["debate"]} for r in rows if r.get("debate")]
    return out
