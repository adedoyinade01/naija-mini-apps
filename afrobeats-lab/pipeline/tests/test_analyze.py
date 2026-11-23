"""Tests run on a small *synthetic* dataset generated here. They check the pipeline, not music facts."""
import json
import math

import numpy as np
import pandas as pd
import pytest

import analyze


def fake_dataset(n_per_genre=120, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for g, dance in [("afrobeat", 0.75), ("pop", 0.6), ("hip-hop", 0.7), ("house", 0.65)]:
        for i in range(n_per_genre):
            d = float(np.clip(rng.normal(dance, 0.08), 0, 1))
            rows.append({
                "track_id": f"{g}-{i}", "artists": f"Artist {i % 15};Feat", "album_name": "A", "track_name": f"{g} song {i}",
                "popularity": int(np.clip(30 + 60 * d + rng.normal(0, 10), 0, 100)), "duration_ms": 200000, "explicit": bool(i % 3 == 0),
                "danceability": d, "energy": float(rng.uniform(0.4, 0.9)), "key": int(rng.integers(0, 12)), "loudness": float(rng.uniform(-12, -3)),
                "mode": int(rng.integers(0, 2)), "speechiness": float(rng.uniform(0.03, 0.3)), "acousticness": float(rng.uniform(0, 0.6)),
                "instrumentalness": float(rng.uniform(0, 0.1)), "liveness": float(rng.uniform(0.05, 0.4)), "valence": float(rng.uniform(0.3, 0.9)),
                "tempo": float(rng.uniform(90 if g == "afrobeat" else 70, 120 if g == "afrobeat" else 170)), "time_signature": 4, "track_genre": g,
            })
    return pd.DataFrame(rows)


@pytest.fixture
def insights(tmp_path):
    csv = tmp_path / "d.csv"
    fake_dataset().to_csv(csv, index=False)
    return analyze.run(csv, tmp_path / "out" / "insights.json"), tmp_path


def test_writes_json(insights):
    ins, tmp = insights
    on_disk = json.loads((tmp / "out" / "insights.json").read_text())
    assert on_disk["afrobeat"]["tracks"] == 120
    assert set(on_disk["genres"]) == {"afrobeat", "pop", "hip-hop", "house"}


def test_models_learn_the_planted_signal(insights):
    ins, _ = insights
    # popularity was generated from danceability, so the hit model should beat chance clearly
    assert ins["hitModel"]["cvAuc"]["logisticRegression"]["mean"] > 0.7
    assert next(iter(ins["hitModel"]["featureImportance"])) == "danceability"
    assert ins["genreModel"]["cvAuc"]["mean"] > 0.6


def test_browser_model_matches_sklearn(insights, tmp_path):
    """The JS dashboard uses: p = sigmoid(intercept + Σ coef * (x - mean) / scale). Check that formula."""
    ins, _ = insights
    m = ins["hitModel"]["browserModel"]
    x = [0.8, 0.7, 0.6, 0.1, 0.1, 105]
    z = m["intercept"] + sum(c * (v - mu) / s for c, v, mu, s in zip(m["coef"], x, m["mean"], m["scale"]))
    p = 1 / (1 + math.exp(-z))
    # refit the same pipeline and compare
    df = fake_dataset()
    afro = df[df.track_genre == "afrobeat"]
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    thr = afro.popularity.quantile(0.75)
    pipe = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    pipe.fit(afro[m["features"]].values, (afro.popularity >= thr).astype(int))
    assert p == pytest.approx(pipe.predict_proba([x])[0, 1], abs=1e-3)


def test_rejects_wrong_csv(tmp_path):
    p = tmp_path / "bad.csv"
    pd.DataFrame({"a": [1]}).to_csv(p, index=False)
    with pytest.raises(ValueError, match="missing columns"):
        analyze.load(p)


def test_rejects_csv_without_afrobeat(tmp_path):
    df = fake_dataset()
    df = df[df.track_genre != "afrobeat"]
    p = tmp_path / "noafro.csv"
    df.to_csv(p, index=False)
    with pytest.raises(ValueError, match="afrobeat"):
        analyze.load(p)


def fake_modern(n=400, seed=1):
    rng = np.random.default_rng(seed)
    eras = ["Afrobeats 2008 - 2010", "Afrobeats 2011 - 2013", "Afrobeats 2014 - 2016", "Afrobeats 2017 - 2019"]
    rows = []
    for i in range(n):
        era = eras[i % 4]
        d = float(np.clip(rng.normal(0.7 + 0.03 * (i % 4), 0.08), 0, 1))
        rows.append({"album": "A", "artist": f"Star {i % 20}", "danceability": d, "duration_ms": 200000,
                     "energy": float(rng.uniform(0.5, 0.9)), "instrumentalness": 0.0, "key": 1, "liveness": 0.1,
                     "loudness": float(rng.uniform(-9, -3)), "mode": int(rng.integers(0, 2)), "playlist": era,
                     "popularity": int(np.clip(20 + 60 * d + rng.normal(0, 8), 0, 100)), "speechiness": float(rng.uniform(0.04, 0.2)),
                     "tempo": float(rng.uniform(95, 115)), "time_signature": 4, "track_id": f"m{i}", "track_name": f"Jam {i}",
                     "valence": float(rng.uniform(0.5, 0.9))})
    return pd.DataFrame(rows)


def test_modern_afrobeats_mode(tmp_path):
    spot, modern = tmp_path / "s.csv", tmp_path / "m.csv"
    fake_dataset().to_csv(spot, index=False)
    fake_modern().to_csv(modern, index=False)
    ins = analyze.run(spot, tmp_path / "i.json", afrobeats_csv=modern)
    assert ins["target"] == "afrobeats" and ins["afrobeat"]["tracks"] == 400
    assert "acousticness" not in ins["hitModel"]["browserModel"]["features"]  # not in this dataset
    assert [e["era"] for e in ins["eras"]] == ["2008–10", "2011–13", "2014–16", "2017–19"]
    assert "afrobeat" not in ins["genres"]  # Spotify's tag is dropped in modern mode
    assert ins["hitModel"]["cvAuc"]["logisticRegression"]["mean"] > 0.6

    def no_nan(c):
        raise AssertionError(f"invalid JSON constant {c}")
    json.loads((tmp_path / "i.json").read_text(), parse_constant=no_nan)


def test_era_of():
    assert analyze.era_of("Afrobeats 2017") == ("2017", 2017)
    assert analyze.era_of("Afrobeats 2008 - 2010") == ("2008–10", 2008)
    assert analyze.era_of("Naija Old Skool 2000's") == ("2000s", 2000)
    assert analyze.era_of("Naija Heat 2020") == ("2020", 2020)
    for skip in ["This is Wizkid", "Naija Mix 2012-2016", "Best Afropop Songs of the 2010s", "Zlatan Ibile"]:
        assert analyze.era_of(skip) is None
