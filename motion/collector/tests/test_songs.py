from build import build

ARTISTS = [{"name": "Mavo", "group": "UG", "spotify_id": "m"}, {"name": "Fimi", "group": "UG", "spotify_id": "f"}]
HISTORY = {
    "2026-11-23": {"m": {"listeners": 3_800_000, "daily": 1_000, "tracks": {
        "t1": ["Tumo Weto", 50_000_000, 200_000, False], "t2": ["MONEY CONSTANT", 20_000_000, 90_000, True]}}},
    "2026-11-24": {"m": {"listeners": 3_810_000, "daily": 1_100, "tracks": {
        "t1": ["Tumo Weto", 50_210_000, 210_000, False], "t2": ["MONEY CONSTANT", 20_100_000, 99_000, True],
        "n1": ["New Single", 300_000, 60_000, False]}},
                   "f": {"listeners": 36_000}},
}
CATALOG = {"m": {"releases": [{"id": "alb", "name": "New Single", "type": "single", "date": "2026-11-20"},
                              {"id": "old", "name": "Business", "type": "album", "date": "2026-02-01"}], "collabs": []},
           "f": {"releases": [{"id": "fa", "name": "Fimi EP", "type": "album", "date": "2026-10-01"}], "collabs": []}}
ALBUMS = {"alb": [{"id": "n1", "name": "New Single"}], "fa": [{"id": "x1", "name": "Intro"}, {"id": "x2", "name": "Outro"}]}


def songs(name):
    out = build(HISTORY, CATALOG, ARTISTS, today="2026-11-24", albums=ALBUMS)
    return next(a for a in out["artists"] if a["name"] == name)["songs"]


def test_top_songs_and_features_split():
    s = songs("Mavo")
    assert [t["title"] for t in s["top"]] == ["Tumo Weto", "New Single"]
    assert [t["title"] for t in s["features"]] == ["MONEY CONSTANT"]
    assert s["top"][0]["change"] == 5.0 and s["top"][0]["gained"] == 210_000


def test_latest_release_with_streams():
    latest = songs("Mavo")["latest"]
    assert latest["name"] == "New Single" and latest["charting"] and latest["daily"] == 60_000
    assert latest["tracks"][0]["change"] is None  # brand new, no earlier day to compare


def test_latest_release_without_public_streams():
    s = songs("Fimi")
    assert not s["charting"] and s["latest"]["name"] == "Fimi EP" and not s["latest"]["charting"]
    assert [t["title"] for t in s["latest"]["tracks"]] == ["Intro", "Outro"]
