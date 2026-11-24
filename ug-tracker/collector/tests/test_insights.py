from build import build
from insights import fmt, status_of

ARTISTS = [
    {"name": "Mavo", "group": "UG", "spotify_id": "m"},
    {"name": "Egertton", "group": "UG", "spotify_id": "e"},
    {"name": "Tiny", "group": "UG", "spotify_id": "t"},
    {"name": "ODUMODUBLVCK", "group": "mainstream", "spotify_id": "o"},
    {"name": "Wizkid", "group": "mainstream", "spotify_id": "w"},
]
HISTORY = {
    "2026-11-23": {"m": {"listeners": 3_800_000, "daily": 1_600_000}, "e": {"listeners": 293_300}, "t": {"listeners": 19},
                   "o": {"listeners": 3_800_000, "daily": 1_100_000}, "w": {"listeners": 15_300_000, "daily": 5_700_000}},
    "2026-11-24": {"m": {"listeners": 3_800_000, "daily": 1_620_000}, "e": {"listeners": 300_600}, "t": {"listeners": 25},
                   "o": {"listeners": 3_800_000, "daily": 1_130_000}, "w": {"listeners": 15_300_000, "daily": 5_100_000}},
}
CATALOG = {
    "m": {"releases": [], "collabs": [
        {"track": "MONEY CONSTANT", "track_id": "1", "date": "2025-10-24", "with": [{"id": "w", "name": "Wizkid"}]},
        {"track": "Idk", "track_id": "2", "date": "2025-11-01", "with": [{"id": "o", "name": "ODUMODUBLVCK"}]},
        {"track": "Street", "track_id": "3", "date": "2026-01-01", "with": [{"id": "e", "name": "Egertton"}]},
    ]},
}


def out():
    return build(HISTORY, CATALOG, ARTISTS, today="2026-11-24")


def by(o, name):
    return next(a for a in o["artists"] if a["name"] == name)


def test_fmt():
    assert fmt(3_800_000) == "3.8M" and fmt(740_500) == "740K" and fmt(7_300) == "7.3K" and fmt(-3_000) == "-3K" and fmt(19) == "19"


def test_status_words():
    assert status_of({"listenersChange": 2.5})["key"] == "rising"
    assert status_of({"listenersChange": 0.0})["key"] == "steady"
    assert status_of({"listenersChange": -0.5})["key"] == "dipping"
    assert status_of({"listenersChange": None})["key"] == "new"


def test_gains_and_summary():
    e = by(out(), "Egertton")
    assert e["listenersGained"] == 7_300 and e["gainedPerDay"] == 7_300
    assert "up 2.5% since 23 Nov (+7.3K listeners)" in e["summary"]


def test_comparison_and_meter():
    m = by(out(), "Mavo")
    assert m["comparison"] == "about as many listeners as ODUMODUBLVCK"
    assert m["meter"]["label"] == "Crossed over" and m["meter"]["score"] == 90  # 50 reach + 20 (2 of 3 features) + 20 charts
    assert by(out(), "Egertton")["meter"]["label"] == "Underground"
    assert by(out(), "Wizkid")["meter"] is None


def test_debate_only_for_crossed_over():
    o = out()
    assert [d["name"] for d in o["debates"]] == ["Mavo"]
    d = o["debates"][0]
    assert d["question"] == "Is Mavo still UG?"
    assert any("Egertton" in s for s in d["still"]) and any("Wizkid" in s for s in d["graduated"])


def test_story_ignores_tiny_profiles():
    s = " ".join(out()["story"])
    assert "Egertton grew the most overnight: +2.5%" in s
    assert "Tiny" not in s  # 19 -> 25 listeners is +31% but meaningless
    assert "Mavo is the biggest UG act" in s and "crossed over" in s
