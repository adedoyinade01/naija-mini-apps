"""
Data sources for the UG Wave Tracker. Standard library only.

  SpotifyAPI   official Web API (client credentials): find artists, list releases, read features.
               Since Feb 2026, development-mode apps don't get followers/popularity, so this is
               used for the catalog and the collaboration network only.
  kworb        kworb.net per-artist pages: total and daily Spotify streams per song.
  web          open.spotify.com artist pages: monthly listeners from the page's meta description.
               Not an official API. One polite request per artist per run, and it can be switched off.
"""
from __future__ import annotations

import base64
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "UGWaveTracker/1.0 (personal music-data project; one request per artist per day)"


class FetchError(Exception):
    def __init__(self, status, url):
        super().__init__(f"HTTP {status} for {url}")
        self.status = status


def fetch(url, *, headers=None, data=None, retries=3, timeout=20) -> str:
    """GET/POST with retries. Honours Retry-After on 429."""
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries:
                wait = int(e.headers.get("Retry-After", "5") or 5)
                if wait > 300:  # Spotify sometimes bans for hours: give up for this run, try again tomorrow
                    raise FetchError(429, url) from None
                time.sleep(wait + 1)
                continue
            if e.code >= 500 and attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise FetchError(e.code, url) from None
        except urllib.error.URLError:
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise
    raise FetchError(0, url)


# ---------------------------------------------------------------- number parsing

def parse_compact(text: str) -> int | None:
    """'15.6M' -> 15600000, '345.2K' -> 345200, '12,345' -> 12345."""
    m = re.search(r"([\d.,]+)\s*([KMB])?", text.strip(), re.I)
    if not m:
        return None
    num, suffix = m.group(1), (m.group(2) or "").upper()
    if suffix:
        value = float(num.replace(",", ""))
        return int(round(value * {"K": 1e3, "M": 1e6, "B": 1e9}[suffix]))
    return int(num.replace(",", "").split(".")[0])


# ---------------------------------------------------------------- open.spotify.com

LISTENERS_RE = re.compile(r"([\d.,]+\s*[KMB]?)\s+monthly listeners", re.I)


def parse_monthly_listeners(page: str) -> int | None:
    for m in re.finditer(r'<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"', page, re.I):
        found = LISTENERS_RE.search(html.unescape(m.group(1)))
        if found:
            return parse_compact(found.group(1))
    found = LISTENERS_RE.search(page)  # fallback: anywhere in the page
    return parse_compact(found.group(1)) if found else None


def web_monthly_listeners(artist_id: str, get=fetch, debug_path=None) -> int | None:
    page = get(f"https://open.spotify.com/artist/{artist_id}")
    value = parse_monthly_listeners(page)
    if value is None and debug_path:
        with open(debug_path, "w", encoding="utf-8") as f:
            f.write(page)
    return value


# ---------------------------------------------------------------- kworb.net

ROW_RE = re.compile(
    r'<tr[^>]*>\s*<td[^>]*>(?P<title>.*?)</td>\s*<td[^>]*>(?P<total>[\d,]+)</td>\s*<td[^>]*>(?P<daily>[\d,]*)</td>',
    re.S | re.I,
)
TRACK_RE = re.compile(r"open\.spotify\.com/track/([A-Za-z0-9]{22})")


def parse_kworb_songs(page: str) -> dict:
    """Returns {'tracks': [{id, title, total, daily, feature}], 'total': int, 'daily': int}."""
    tracks = []
    for m in ROW_RE.finditer(page):
        cell = m.group("title")
        tid = TRACK_RE.search(cell)
        if not tid:
            continue  # summary rows have no track link
        title = html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()
        feature = title.startswith("*")
        tracks.append({
            "id": tid.group(1),
            "title": title.lstrip("* ").strip(),
            "total": int(m.group("total").replace(",", "")),
            "daily": int(m.group("daily").replace(",", "")) if m.group("daily") else 0,
            "feature": feature,
        })
    return {
        "tracks": tracks,
        "total": sum(t["total"] for t in tracks),
        "daily": sum(t["daily"] for t in tracks),
    }


def kworb_artist(artist_id: str, get=fetch) -> dict | None:
    try:
        return parse_kworb_songs(get(f"https://kworb.net/spotify/artist/{artist_id}_songs.html"))
    except FetchError as e:
        if e.status == 404:
            return None  # kworb doesn't cover this artist (yet)
        raise


# ---------------------------------------------------------------- official API

class SpotifyAPI:
    BASE = "https://api.spotify.com/v1"

    def __init__(self, client_id: str, client_secret: str, get=fetch):
        self.client_id, self.client_secret, self.get = client_id, client_secret, get
        self._token, self._expires = None, 0.0

    def token(self) -> str:
        if self._token and time.time() < self._expires - 60:
            return self._token
        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        body = self.get(
            "https://accounts.spotify.com/api/token",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
            data=b"grant_type=client_credentials",
        )
        data = json.loads(body)
        self._token, self._expires = data["access_token"], time.time() + data.get("expires_in", 3600)
        return self._token

    def api(self, path: str, **params) -> dict:
        url = self.BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        return json.loads(self.get(url, headers={"Authorization": f"Bearer {self.token()}"}))

    def release_count(self, artist_id: str) -> int:
        return self.api(f"/artists/{artist_id}/albums", include_groups="album,single", limit=1).get("total", 0)

    def find_artist(self, name: str) -> dict | None:
        """Best match for a name.

        Popular names have copycat/duplicate profiles with the exact same name, and Spotify no longer
        tells development-mode apps who is more popular. So among exact-name matches we pick the
        profile with the most releases (the real artist has a catalogue; duplicates usually don't).
        """
        items = self.api("/search", q=name, type="artist", limit=10).get("artists", {}).get("items", [])
        if not items:
            return None
        exact = [a for a in items if a["name"].casefold() == name.casefold()]
        candidates = exact or items[:1]
        scored = []
        for a in candidates[:5]:
            try:
                scored.append((self.release_count(a["id"]), a))
            except FetchError:
                scored.append((-1, a))
        count, best = max(scored, key=lambda x: x[0])
        return {"id": best["id"], "name": best["name"], "exact": bool(exact), "releases": count,
                "candidates": len(exact), "image": (best.get("images") or [{}])[0].get("url")}

    def artist(self, artist_id: str) -> dict:
        a = self.api(f"/artists/{artist_id}")
        return {"id": a["id"], "name": a["name"], "image": (a.get("images") or [{}])[0].get("url")}

    def releases(self, artist_id: str, group: str, max_items: int = 40) -> list[dict]:
        """group: 'album,single' for their own releases, 'appears_on' for features on other people's."""
        out, offset = [], 0
        while len(out) < max_items:
            page = self.api(f"/artists/{artist_id}/albums", include_groups=group, limit=10, offset=offset)
            items = page.get("items", [])
            out += [{"id": a["id"], "name": a["name"], "type": a.get("album_type"), "date": a.get("release_date"),
                     "artists": [{"id": x["id"], "name": x["name"]} for x in a.get("artists", [])]} for a in items]
            if not page.get("next") or not items:
                break
            offset += len(items)
        return out[:max_items]

    def album_tracks(self, album_id: str) -> list[dict]:
        page = self.api(f"/albums/{album_id}/tracks", limit=50)
        return [{"id": t["id"], "name": t["name"], "artists": [{"id": x["id"], "name": x["name"]} for x in t.get("artists", [])]}
                for t in page.get("items", [])]
