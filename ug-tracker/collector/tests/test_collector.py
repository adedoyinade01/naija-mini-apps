import json
from pathlib import Path

import pytest

import sources
from build import build, norm_date

FIX = Path(__file__).parent / "fixtures"


# ---------- parsing ----------
@pytest.mark.parametrize("text,expected", [
    ("15.6M", 15_600_000), ("345.2K", 345_200), ("12,345", 12_345), ("1.2B", 1_200_000_000), ("987", 987),
])
def test_parse_compact(text, expected):
    assert sources.parse_compact(text) == expected


def test_monthly_listeners_from_meta():
    assert sources.parse_monthly_listeners((FIX / "spotify_artist.html").read_text()) == 15_600_000


def test_monthly_listeners_small_artist_and_missing():
    page = '<meta property="og:description" content="Artist · 48,213 monthly listeners.">'
    assert sources.parse_monthly_listeners(page) == 48_213
    assert sources.parse_monthly_listeners("<html>nothing here</html>") is None


def test_kworb_songs():
    r = sources.parse_kworb_songs((FIX / "kworb_songs.html").read_text())
    assert [t["title"] for t in r["tracks"]] == ["One Dance", "Essence (feat. Tems)", "Old & Quiet"]
    assert r["tracks"][0]["feature"] is True and r["tracks"][1]["feature"] is False
    assert r["tracks"][2]["daily"] == 0
    assert r["daily"] == 1_572_562 + 176_556


def test_kworb_404_is_none():
    def get(url, **kw):
        raise sources.FetchError(404, url)
    assert sources.kworb_artist("x" * 22, get=get) is None


# ---------- official API (mocked) ----------
def fake_spotify():
    def get(url, headers=None, data=None, **kw):
        if "accounts.spotify.com" in url:
            return json.dumps({"access_token": "t", "expires_in": 3600})
        if "/search" in url:
            return json.dumps({"artists": {"items": [{"id": "B" * 22, "name": "Mavo Fan Page", "images": []},
                                                     {"id": "C" * 22, "name": "Mavo", "images": []},
                                                     {"id": "A" * 22, "name": "Mavo", "images": [{"url": "img"}]}]}})
        if "/albums?" in url and url.endswith("limit=1"):
            return json.dumps({"total": 25 if "A" * 22 in url else 0, "items": []})
        if "/albums?" in url and "appears_on" in url:
            return json.dumps({"items": [], "next": None})
        if "/albums?" in url:
            return json.dumps({"items": [{"id": "al1", "name": "Kilometer", "album_type": "single", "release_date": "2025-06",
                                          "artists": [{"id": "A" * 22, "name": "Mavo"}]}], "next": None})
        raise AssertionError(url)
    return sources.SpotifyAPI("id", "secret", get=get)


def test_find_artist_picks_real_profile_among_duplicates():
    found = fake_spotify().find_artist("mavo")
    assert found["id"] == "A" * 22 and found["exact"] and found["releases"] == 25 and found["candidates"] == 2


def test_releases():
    rel = fake_spotify().releases("A" * 22, "album,single")
    assert rel[0]["name"] == "Kilometer" and rel[0]["date"] == "2025-06"


# ---------- build ----------
ARTISTS = [
    {"name": "Mavo", "group": "UG", "spotify_id": "m"},
    {"name": "Zay", "group": "UG", "spotify_id": "z"},
    {"name": "Wizkid", "group": "mainstream", "spotify_id": "w"},
]


def snapshot(lis, daily, tracks=None):
    return {"listeners": lis, "daily": daily, "streams": daily * 100, "tracks": tracks or {}}


def test_build_growth_groups_and_climbers():
    history = {
        "2026-11-01": {"m": snapshot(1_000_000, 50_000, {"t1": ["Tumo Weto", 9e6, 20_000]}), "w": snapshot(15_000_000, 900_000)},
        "2026-11-08": {"m": snapshot(1_200_000, 60_000, {"t1": ["Tumo Weto", 9.5e6, 30_000], "t2": ["New One", 1e5, 8_000]}),
                       "w": snapshot(15_300_000, 880_000)},
    }
    out = build(history, {}, ARTISTS, today="2026-11-08")
    mavo = next(a for a in out["artists"] if a["name"] == "Mavo")
    assert mavo["listenersChange"] == 20.0 and mavo["dailyChange"] == 20.0
    assert out["artists"][0]["name"] == "Wizkid"  # sorted by listeners
    assert out["groupSeries"][-1] == {"date": "2026-11-08", "UG": 60_000, "mainstream": 880_000}
    assert out["climbers"][0]["track"] == "Tumo Weto" and out["climbers"][0]["change"] == 50.0
    assert any(c["track"] == "New One" and c["new"] for c in out["climbers"])


def test_build_with_less_than_a_week_compares_to_first_day():
    history = {"2026-11-06": {"z": snapshot(100_000, 1_000)}, "2026-11-08": {"z": snapshot(110_000, 1_500)}}
    z = next(a for a in build(history, {}, ARTISTS, today="2026-11-08")["artists"] if a["name"] == "Zay")
    assert z["listenersChange"] == 10.0 and z["changeSince"] == "2026-11-06"


def test_network_crossovers_and_names_to_watch():
    catalog = {
        "m": {"releases": [{"id": "r1", "name": "Business", "type": "album", "date": "2026-02-01"}], "collabs": [
            {"track": "Big Feature", "track_id": "x1", "date": "2025-10-01", "with": [{"id": "w", "name": "Wizkid"}]},
            {"track": "Bigger Feature", "track_id": "x0", "date": "2025-12-01", "with": [{"id": "w", "name": "Wizkid"}]},
            {"track": "Street 1", "track_id": "x2", "date": "2026-05-01", "with": [{"id": "new", "name": "Fresh Guy"}]},
        ]},
        "z": {"releases": [], "collabs": [
            {"track": "Street 2", "track_id": "x3", "date": "2026-06-01", "with": [{"id": "new", "name": "Fresh Guy"}]},
            {"track": "Old one", "track_id": "x4", "date": "2019", "with": [{"id": "old", "name": "Old Guy"}]},
        ]},
    }
    out = build({"2026-11-08": {}}, catalog, ARTISTS, today="2026-11-08")
    assert out["crossovers"][0] == {"ug": "Mavo", "mainstream": "Wizkid", "date": "2025-10-01", "track": "Big Feature", "tracks": 2}
    assert out["namesToWatch"][0]["name"] == "Fresh Guy" and out["namesToWatch"][0]["with"] == ["Mavo", "Zay"]
    assert all(n["name"] != "Old Guy" for n in out["namesToWatch"])
    ids = {n["id"] for n in out["network"]["nodes"]}
    assert "new" in ids and "old" not in ids
    assert out["releases"][0]["name"] == "Business"


def test_norm_date():
    assert norm_date("2025") == "2025-01-01" and norm_date("2025-6") == "2025-06-01" and norm_date(None) == "1900-01-01"
