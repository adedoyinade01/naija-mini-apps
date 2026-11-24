import json

from build import build
from report import weekly_report

ARTISTS = [{"name": "Egertton", "group": "UG", "spotify_id": "e"}, {"name": "Mavo", "group": "UG", "spotify_id": "m"},
           {"name": "ODUMODUBLVCK", "group": "mainstream", "spotify_id": "o"}]


def hist():
    h = {}
    for i, d in enumerate(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]):
        h[d] = {"e": {"listeners": 290_000 + i * 10_000},
                "m": {"listeners": 3_000_000 + i * 200_000, "daily": 1_000_000,
                      "tracks": {"a": ["Tumo Weto", 50_000_000 + i * 200_000, 200_000, False]}},
                "o": {"listeners": 3_800_000}}
    return h


CATALOG = {"e": {"releases": [{"id": "bp", "name": "Big Professor", "type": "single", "date": "2026-11-25"}], "collabs": []},
           "m": {"releases": [], "collabs": [{"track": "x", "track_id": "x", "date": "2025-10-01", "with": [{"id": "o", "name": "ODUMODUBLVCK"}]}]}}


def test_report_contents():
    out = build(hist(), CATALOG, ARTISTS, today="2026-11-27", albums={"bp": [{"id": "q", "name": "Big Professor"}]})
    w = out["week"]
    assert w["title"] == "Motion Report · 23 Nov – 27 Nov" and w["days"] == 4 and "Covers 4 days" in w["note"]
    assert [m["name"] for m in w["topMovers"]] == ["Mavo", "Egertton"]
    assert w["songs"][0] == {"title": "Tumo Weto", "artist": "Mavo", "group": "UG", "gained": 800_000, "daily": 200_000}
    assert w["drops"][0]["name"] == "Big Professor"
    assert {"name": "Mavo", "from": "Breaking through", "to": "Crossed over"} in w["meterMoves"]
    assert w["thread"][0].startswith("MOTION REPORT") and all(len(t) <= 280 for t in w["thread"])
    json.dumps(w)


def test_no_report_with_one_day():
    h = {"2026-11-23": hist()["2026-11-23"]}
    out = build(h, {}, ARTISTS, today="2026-11-23")
    assert out["week"] is None
