"""
UG Wave Tracker: daily collector.

    python collect.py                 # full daily run
    python collect.py --catalog       # also refresh releases + collaborations now
    python collect.py --no-web        # skip open.spotify.com
    python collect.py --build-only    # just rebuild data/ug.json from saved data

Keys come from environment variables, or from a .env file next to this script:
    SPOTIFY_CLIENT_ID=...
    SPOTIFY_CLIENT_SECRET=...
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import date
from pathlib import Path

import sources
from build import build

ROOT = Path(__file__).resolve().parent.parent
ARTISTS = ROOT / "artists.json"
DATA = ROOT / "data"
HISTORY, CATALOG, META, OUT = DATA / "history.json", DATA / "catalog.json", DATA / "meta.json", DATA / "ug.json"
ALBUMS = DATA / "albums_cache.json"
CATALOG_MAX_AGE_DAYS = 6
RELEASES_PER_GROUP = 12
TRACKS_KEPT = 15


def log(*a):
    print(*a, flush=True)


def load_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save_json(path: Path, obj, indent=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=indent, sort_keys=True))
    tmp.replace(path)


def load_env():
    env = Path(__file__).with_name(".env")
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def pause(lo, hi):
    time.sleep(random.uniform(lo, hi))


# ---------------------------------------------------------------- steps

def resolve_ids(api, cfg) -> bool:
    changed = False
    for a in cfg["artists"]:
        if a.get("spotify_id"):
            continue
        found = api.find_artist(a["name"])
        if not found:
            log(f"  ✗ {a['name']}: not found on Spotify, check the spelling")
            continue
        a["spotify_id"] = found["id"]
        changed = True
        note = "" if found["exact"] else f"  ⚠ closest match was '{found['name']}', check it"
        if found["candidates"] > 1:
            note += f"  ({found['candidates']} profiles share this name; picked the one with {found['releases']} releases)"
        if found["releases"] == 0:
            note += "  ⚠ 0 releases, probably the wrong profile: paste the right ID into artists.json"
        log(f"  ✓ {a['name']} → {found['id']}{note}")
    return changed


def refresh_catalog(api, artists, catalog, meta, today, only_missing=False):
    # Album track lists never change, so they're cached on disk between runs: a weekly refresh only
    # asks Spotify about new releases. This keeps us well under the API rate limit.
    album_cache = load_json(ALBUMS, {})

    def tracks_of(album_id):
        if album_id not in album_cache:
            album_cache[album_id] = api.album_tracks(album_id)
            pause(0.4, 0.8)
        return album_cache[album_id]

    for a in artists:
        aid = a["spotify_id"]
        if only_missing and aid in catalog:
            continue
        try:
            info = api.artist(aid)
            meta.setdefault("images", {})[aid] = info["image"]
            own = api.releases(aid, "album,single", RELEASES_PER_GROUP)
            appears = api.releases(aid, "appears_on", RELEASES_PER_GROUP)
            collabs = []
            for rel in own + appears:
                for t in tracks_of(rel["id"]):
                    ids = {x["id"] for x in t["artists"]}
                    if aid in ids and len(ids) > 1:
                        collabs.append({"track": t["name"], "track_id": t["id"], "date": rel["date"], "album": rel["name"],
                                        "with": [x for x in t["artists"] if x["id"] != aid]})
            catalog[aid] = {"releases": own, "collabs": collabs, "updated": today}
            log(f"  ✓ {a['name']}: {len(own)} releases, {len(collabs)} collab tracks")
        except sources.FetchError as e:
            log(f"  ✗ {a['name']}: {e}")
            if e.status == 429:
                log("  Spotify rate limit hit: stopping the catalog step, the rest will be fetched next run")
                break
        finally:
            save_json(ALBUMS, album_cache)
        pause(1, 2)


def latest_release_tracks(aid, catalog, albums, n_releases=2):
    """Track IDs of an artist's newest releases, so we always keep their numbers."""
    rel = sorted(catalog.get(aid, {}).get("releases", []), key=lambda r: r.get("date") or "", reverse=True)[:n_releases]
    return {t["id"] for r in rel for t in albums.get(r["id"], [])}


def collect_numbers(artists, use_web, today, history, catalog=None, albums=None):
    snap = history.setdefault(today, {})
    ok = {"kworb": 0, "web": 0}
    for a in artists:
        aid = a["spotify_id"]
        row = snap.setdefault(aid, {})
        try:
            k = sources.kworb_artist(aid)
            if k:
                # keep: hottest right now, all-time biggest, and everything from their newest releases
                keep = {t["id"] for t in sorted(k["tracks"], key=lambda t: -t["daily"])[:TRACKS_KEPT]}
                keep |= {t["id"] for t in sorted(k["tracks"], key=lambda t: -t["total"])[:TRACKS_KEPT]}
                keep |= latest_release_tracks(aid, catalog or {}, albums or {})
                row.update(streams=k["total"], daily=k["daily"],
                           tracks={t["id"]: [t["title"], t["total"], t["daily"], t["feature"]] for t in k["tracks"] if t["id"] in keep})
                ok["kworb"] += 1
        except Exception as e:  # keep going: one artist failing shouldn't kill the run
            log(f"  ✗ kworb {a['name']}: {e}")
        pause(1, 2)
        if use_web:
            try:
                debug = Path(__file__).with_name("debug_spotify_page.html") if not ok["web"] else None
                lis = sources.web_monthly_listeners(aid, debug_path=debug)
                if lis is not None:
                    row["listeners"] = lis
                    ok["web"] += 1
            except Exception as e:
                log(f"  ✗ open.spotify.com {a['name']}: {e}")
            pause(2, 4)
        log(f"  · {a['name']}: listeners={row.get('listeners')} daily={row.get('daily')}")
    return ok


# ---------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--catalog", action="store_true", help="refresh releases/collabs now")
    p.add_argument("--no-web", action="store_true", help="skip open.spotify.com")
    p.add_argument("--build-only", action="store_true")
    p.add_argument("--report", action="store_true", help="archive this week's Motion Report now (normally Fridays)")
    args = p.parse_args()
    load_env()

    today = date.today().isoformat()
    cfg = load_json(ARTISTS, None)
    if not cfg:
        sys.exit("artists.json not found")
    history, catalog, meta = load_json(HISTORY, {}), load_json(CATALOG, {}), load_json(META, {})

    if not args.build_only:
        cid, secret = os.getenv("SPOTIFY_CLIENT_ID"), os.getenv("SPOTIFY_CLIENT_SECRET")
        api = sources.SpotifyAPI(cid, secret) if cid and secret else None
        if api:
            log("Spotify API: resolving artists")
            if resolve_ids(api, cfg):
                save_json(ARTISTS, cfg, indent=2)
        else:
            log("No SPOTIFY_CLIENT_ID/SECRET: skipping the official API (network + releases)")

        artists = [a for a in cfg["artists"] if a.get("spotify_id")]
        oldest = min((c.get("updated", "1900-01-01") for c in catalog.values()), default="1900-01-01")
        stale = (date.fromisoformat(today) - date.fromisoformat(oldest)).days >= CATALOG_MAX_AGE_DAYS
        missing = any(a["spotify_id"] not in catalog for a in artists)
        if api and (args.catalog or stale or missing):
            log("Spotify API: releases + collaborations")
            refresh_catalog(api, artists, catalog, meta, today, only_missing=not (args.catalog or stale))
            catalog = {aid: c for aid, c in catalog.items() if aid in {a["spotify_id"] for a in artists}}
            save_json(CATALOG, catalog)
            save_json(META, meta)

        use_web = not args.no_web and os.getenv("ENABLE_WEB_SCRAPE", "1") != "0"
        log(f"Daily numbers: kworb{' + open.spotify.com' if use_web else ''}")
        ok = collect_numbers(artists, use_web, today, history, catalog, load_json(ALBUMS, {}))
        save_json(HISTORY, history)
        log(f"Done: kworb {ok['kworb']}/{len(artists)}, web {ok['web']}/{len(artists) if use_web else 0}")

    images = meta.get("images", {})
    artists = [{**a, "image": images.get(a.get("spotify_id"))} for a in cfg["artists"]]
    result = build(history, catalog, artists, today, albums=load_json(ALBUMS, {}))
    save_json(OUT, result, indent=1)
    # Every Friday, archive that week's Motion Report
    if (date.fromisoformat(today).weekday() == 4 or args.report) and result.get("week"):
        save_json(DATA / "reports" / f"{today}.json", result["week"], indent=1)
        index = [r for r in load_json(DATA / "reports" / "index.json", []) if r["date"] != today]
        index.insert(0, {"date": today, "title": result["week"]["title"]})
        save_json(DATA / "reports" / "index.json", index, indent=1)
        log(f"Archived {result['week']['title']}")
    log(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
