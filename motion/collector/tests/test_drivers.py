from build import build

ARTISTS = [{"name": "Egertton", "group": "UG", "spotify_id": "e"},
           {"name": "Mavo", "group": "UG", "spotify_id": "m"},
           {"name": "ODUMODUBLVCK", "group": "mainstream", "spotify_id": "o"}]
HISTORY = {
    "2026-11-23": {"e": {"listeners": 293_300},
                   "m": {"listeners": 3_750_000, "daily": 1_000_000, "tracks": {
                       "a": ["Tumo Weto", 50_000_000, 200_000, False], "b": ["Old", 9_000_000, 30_000, False]}},
                   "o": {"listeners": 3_800_000}},
    "2026-11-24": {"e": {"listeners": 300_500},
                   "m": {"listeners": 3_800_000, "daily": 1_200_000, "tracks": {
                       "a": ["Tumo Weto", 50_200_000, 210_000, False], "b": ["Old", 9_030_000, 31_000, False],
                       "n": ["Hot New One", 400_000, 300_000, False]}},
                   "o": {"listeners": 3_800_000}},
}
CATALOG = {"e": {"releases": [{"id": "bp", "name": "Big Professor", "type": "single", "date": "2026-11-19"}], "collabs": []},
           "m": {"releases": [{"id": "ep", "name": "New EP", "type": "album", "date": "2026-11-22"}], "collabs": []}}
ALBUMS = {"bp": [{"id": "x", "name": "Big Professor"}], "ep": [{"id": "n", "name": "Hot New One"}, {"id": "z", "name": "Interlude"}]}


def out():
    return build(HISTORY, CATALOG, ARTISTS, today="2026-11-24", albums=ALBUMS)


def by(o, n):
    return next(a for a in o["artists"] if a["name"] == n)


def test_driver_from_song_data():
    d = by(out(), "Mavo")["driver"]
    assert d["kind"] == "song" and d["title"] == "Hot New One" and d["new"] and d["fromRelease"] == "New EP"


def test_likely_driver_without_song_data():
    d = by(out(), "Egertton")["driver"]
    assert d == {"kind": "likely", "title": "Big Professor", "type": "single", "date": "2026-11-19"}


def test_no_driver_when_not_moving():
    assert by(out(), "ODUMODUBLVCK")["driver"] is None


def test_spotlight():
    sp = out()["spotlight"]
    assert [s["artist"] for s in sp] == ["Egertton", "Mavo"]  # sorted by growth
    mavo = sp[1]
    assert mavo["share"] == 25  # 300K of 1.2M daily plays
    assert any("Standout track" in l for l in mavo["lines"])
    egg = sp[0]
    assert egg["beforeTracking"] and egg["gainedSinceDrop"] == 7_200
    assert any("aren't public yet" in l for l in egg["lines"])


def test_story_mentions_the_release():
    s = " ".join(out()["story"])
    assert 'likely off their new single "Big Professor"' in s
