"""
Afrobeats Lab: data pipeline.

Two data sources:
  * Modern Afrobeats (recommended): beatsofafro.csv, ~2,000 Afrobeats tracks with Spotify
    audio features, grouped into era playlists (2008-2010 onwards). D'banj, P-Square,
    Wizkid, Davido, Burna Boy, Olamide, Sarkodie...
  * Comparison genres: the Spotify Tracks Dataset (maharshipandya, Kaggle/Hugging Face),
    used for pop, hip-hop, dancehall, etc.

    python analyze.py data/dataset.csv --afrobeats data/beatsofafro.csv

Without --afrobeats it falls back to Spotify's own "afrobeat" tag, which is mostly
Fela-era Afrobeat and Latin/funk fusion, not modern Afrobeats.

Outputs ../data/insights.json for the dashboard:
  1. Hit predictor: will a track land in the top 25% by popularity?
     LogisticRegression vs RandomForest, 5-fold cross-validated ROC AUC.
     The logistic model's weights are exported so the browser can run it live.
  2. Afrobeats-ness: Afrobeats vs other genres from audio features alone.
  3. Eras: how the sound changed playlist by playlist (modern dataset only).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

SPOTIFY_TAG = "afrobeat"
MODERN = "afrobeats"
COMPARE_GENRES = ["pop", "hip-hop", "dancehall", "reggaeton", "r-n-b", "latin", "k-pop", "house", "reggae"]
ALL_FEATURES = ["danceability", "energy", "valence", "acousticness", "speechiness", "instrumentalness", "liveness", "tempo", "loudness"]
PREFERRED_SLIDERS = ["danceability", "energy", "valence", "acousticness", "speechiness", "tempo", "loudness"]
SPOTIFY_REQUIRED = {"track_id", "artists", "track_name", "popularity", "track_genre", *ALL_FEATURES}
MODERN_REQUIRED = {"track_id", "artist", "track_name", "popularity", "danceability", "energy", "valence", "speechiness", "tempo", "loudness"}
SEED = 42


# ---------------------------------------------------------------- loading

def load(path: str | Path, require_tag: bool = True) -> pd.DataFrame:
    """The Spotify Tracks Dataset (comparison genres, and optionally its 'afrobeat' tag)."""
    df = pd.read_csv(path)
    missing = SPOTIFY_REQUIRED - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing columns: {sorted(missing)}. Is this the Spotify Tracks Dataset?")
    df = df.dropna(subset=["track_name", "artists", *ALL_FEATURES])
    if require_tag and SPOTIFY_TAG not in set(df["track_genre"]):
        raise ValueError(f"No '{SPOTIFY_TAG}' tracks found in track_genre.")
    return df


def load_modern(path: str | Path) -> pd.DataFrame:
    """beatsofafro.csv-style file: one row per Afrobeats track, with a 'playlist' era column."""
    df = pd.read_csv(path)
    missing = MODERN_REQUIRED - set(df.columns)
    if missing:
        raise ValueError(f"Afrobeats CSV is missing columns: {sorted(missing)}")
    df = df.rename(columns={"artist": "artists"})
    df = df.dropna(subset=["track_name", "artists", "danceability", "energy", "tempo", "popularity"])
    df = df.drop_duplicates(subset=["track_id"])
    df["track_genre"] = MODERN
    if len(df) < 100:
        raise ValueError("Need at least 100 Afrobeats tracks.")
    return df


def features_in(df: pd.DataFrame, wanted: list[str]) -> list[str]:
    return [f for f in wanted if f in df.columns and df[f].notna().mean() > 0.95]


def era_of(playlist: str):
    """Map a playlist name to an era label, or None if it isn't an era playlist.

    'Afrobeats 2017' -> '2017', 'Afrobeats 2008 - 2010' -> '2008–10', "Naija Old Skool 2000's" -> '2000s'.
    Artist playlists ('This is Wizkid') and broad mixes ('...2010s', '2012-2016') are skipped.
    """
    name = str(playlist)
    if re.search(r"(19|20)\d0'?s\b", name):
        decade = re.search(r"((19|20)\d0)'?s", name).group(1)
        return None if decade == "2010" else (f"{decade}s", int(decade))
    years = [int(y) for y in re.findall(r"\b((?:19|20)\d{2})\b", name)]
    if not years:
        return None
    lo, hi = min(years), max(years)
    if hi - lo > 2:
        return None
    return (str(lo) if lo == hi else f"{lo}–{str(hi)[2:]}", lo)


# ---------------------------------------------------------------- analysis

def genre_profiles(df: pd.DataFrame, target: str) -> dict:
    """Mean audio profile per genre, with tempo and loudness rescaled to 0-1 for radar charts."""
    genres = [target] + [g for g in COMPARE_GENRES if g in set(df["track_genre"])]
    sub = df[df["track_genre"].isin(genres)].copy()
    sub["tempo_n"] = ((sub["tempo"] - 60) / (200 - 60)).clip(0, 1)
    sub["loudness_n"] = ((sub["loudness"] + 30) / 30).clip(0, 1)
    cols = [c for c in ["danceability", "energy", "valence", "acousticness", "speechiness", "tempo_n", "loudness_n"]
            if sub.loc[sub.track_genre == target, c].notna().any()]
    prof = sub.groupby("track_genre")[cols + ["popularity", "tempo"]].mean().round(3)
    counts = sub["track_genre"].value_counts()
    return {g: {**prof.loc[g].to_dict(), "tracks": int(counts[g])} for g in genres}


def afro_stats(afro: pd.DataFrame) -> dict:
    feats = features_in(afro, ALL_FEATURES)
    tempo_hist, tempo_edges = np.histogram(afro["tempo"], bins=np.arange(60, 211, 10))
    pop_hist, pop_edges = np.histogram(afro["popularity"], bins=np.arange(0, 101, 10))
    corr = afro[feats + ["popularity"]].corr(numeric_only=True)["popularity"].drop("popularity").dropna()
    top = (afro.sort_values("popularity", ascending=False)
           .drop_duplicates(subset=["track_name", "artists"])
           .head(10)[["track_name", "artists", "popularity"]])
    artists = (afro.assign(artist=afro["artists"].astype(str).str.split(";").str[0])
               .groupby("artist")["popularity"].agg(["mean", "count"])
               .query("count >= 5").sort_values("mean", ascending=False).head(10).round(1))
    return {
        "tracks": int(len(afro)),
        "medianTempo": round(float(afro["tempo"].median()), 1),
        "medianPopularity": float(afro["popularity"].median()),
        "majorShare": round(float((afro["mode"] == 1).mean()), 3) if "mode" in afro else None,
        "tempoHist": {"edges": tempo_edges.tolist(), "counts": tempo_hist.tolist()},
        "popularityHist": {"edges": pop_edges.tolist(), "counts": pop_hist.tolist()},
        "popularityCorrelation": corr.round(3).sort_values().to_dict(),
        "topTracks": top.to_dict("records"),
        "topArtists": [{"artist": a, "avgPopularity": r["mean"], "tracks": int(r["count"])} for a, r in artists.iterrows()],
    }


def eras(afro: pd.DataFrame) -> list[dict]:
    """How the sound changed across year/era playlists (modern dataset only)."""
    if "playlist" not in afro:
        return []
    feats = features_in(afro, ["danceability", "energy", "valence", "speechiness", "tempo"])
    mapped = afro.assign(_era=afro["playlist"].map(era_of)).dropna(subset=["_era"])
    mapped = mapped.assign(_label=mapped["_era"].str[0], _start=mapped["_era"].str[1])
    out = []
    for name, grp in sorted(mapped.groupby("_label"), key=lambda kv: kv[1]["_start"].iloc[0]):
        if len(grp) < 15:
            continue
        top = grp.sort_values("popularity", ascending=False).iloc[0]
        out.append({
            "era": str(name), "tracks": int(len(grp)), "popularity": round(float(grp["popularity"].mean()), 1),
            **{f: round(float(grp[f].mean()), 3) for f in feats},
            "topTrack": f"{top['track_name']} · {top['artists']}",
        })
    return out


def clean(o):
    """Replace NaN/inf with None so the output is strict JSON."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


def export_logreg(pipe, feature_names) -> dict:
    scaler, lr = pipe.named_steps["standardscaler"], pipe.named_steps["logisticregression"]
    return {
        "features": feature_names,
        "mean": scaler.mean_.round(6).tolist(),
        "scale": scaler.scale_.round(6).tolist(),
        "coef": lr.coef_[0].round(6).tolist(),
        "intercept": round(float(lr.intercept_[0]), 6),
    }


def train_hit_model(afro: pd.DataFrame, feats: list[str]) -> dict:
    afro = afro.drop_duplicates(subset=["track_id"])
    threshold = float(afro["popularity"].quantile(0.75))
    X, y = afro[feats].values, (afro["popularity"] >= threshold).astype(int).values
    if y.sum() < 10 or (len(y) - y.sum()) < 10:
        raise ValueError("Not enough tracks to train the hit model.")

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    logreg = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    forest = RandomForestClassifier(n_estimators=300, min_samples_leaf=5, class_weight="balanced", random_state=SEED, n_jobs=-1)
    auc_lr = cross_val_score(logreg, X, y, cv=cv, scoring="roc_auc")
    auc_rf = cross_val_score(forest, X, y, cv=cv, scoring="roc_auc")
    logreg.fit(X, y)
    forest.fit(X, y)
    importance = dict(sorted(zip(feats, forest.feature_importances_.round(4).tolist()), key=lambda kv: -kv[1]))

    return {
        "label": f"popularity ≥ {threshold:.0f} (top 25% of tracks)",
        "threshold": threshold,
        "samples": int(len(y)),
        "positives": int(y.sum()),
        "cvAuc": {
            "logisticRegression": {"mean": round(float(auc_lr.mean()), 3), "std": round(float(auc_lr.std()), 3)},
            "randomForest": {"mean": round(float(auc_rf.mean()), 3), "std": round(float(auc_rf.std()), 3)},
        },
        "featureImportance": importance,
        "browserModel": export_logreg(logreg, feats),
    }


def train_genre_model(df: pd.DataFrame, target: str, feats: list[str]) -> dict:
    others = [g for g in COMPARE_GENRES if g in set(df["track_genre"])]
    sub = df[df["track_genre"].isin([target] + others)].drop_duplicates(subset=["track_id"])
    X, y = sub[feats].values, (sub["track_genre"] == target).astype(int).values
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    pipe = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    auc = cross_val_score(pipe, X, y, cv=cv, scoring="roc_auc")
    pipe.fit(X, y)
    return {
        "against": others,
        "samples": int(len(y)),
        "cvAuc": {"mean": round(float(auc.mean()), 3), "std": round(float(auc.std()), 3)},
        "browserModel": export_logreg(pipe, feats),
    }


def similar_song_index(afro: pd.DataFrame, feats: list[str], n: int = 500) -> dict:
    top = (afro.sort_values("popularity", ascending=False)
           .drop_duplicates(subset=["track_name", "artists"]).head(n))
    return {
        "features": feats,
        "tracks": [
            {"name": str(r["track_name"]), "artist": str(r["artists"]).replace(";", ", "), "popularity": int(r["popularity"]),
             "v": [round(float(r[f]), 4) for f in feats]}
            for _, r in top.iterrows()
        ],
    }


# ---------------------------------------------------------------- main

def run(csv_path, out_path, afrobeats_csv=None) -> dict:
    if afrobeats_csv:
        compare = load(csv_path, require_tag=False)
        compare = compare[compare["track_genre"] != SPOTIFY_TAG]
        afro = load_modern(afrobeats_csv)
        target = MODERN
        df = pd.concat([afro, compare], ignore_index=True)
        source = ("Afrobeats: beatsofafro.csv (Spotify audio features, era playlists) · "
                  "other genres: Spotify Tracks Dataset (maharshipandya)")
    else:
        df = load(csv_path)
        afro = df[df["track_genre"] == SPOTIFY_TAG]
        target = SPOTIFY_TAG
        source = "Spotify Tracks Dataset (maharshipandya), Spotify's 'afrobeat' tag"

    feats = features_in(afro, PREFERRED_SLIDERS)[:6]

    insights = {
        "generated": date.today().isoformat(),
        "target": target,
        "targetLabel": "Afrobeats" if target == MODERN else "Afrobeat (Spotify tag)",
        "source": source,
        "datasetRows": int(len(df)),
        "afrobeat": afro_stats(afro),
        "eras": eras(afro),
        "genres": genre_profiles(df, target),
        "hitModel": train_hit_model(afro, feats),
        "genreModel": train_genre_model(df, target, feats),
        "similar": similar_song_index(afro, feats),
        "sliderRanges": {f: [round(float(afro[f].quantile(0.02)), 3), round(float(afro[f].quantile(0.98)), 3)] for f in feats},
    }
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    insights = clean(insights)
    out.write_text(json.dumps(insights, ensure_ascii=False, indent=1, allow_nan=False, default=str))
    return insights


def main():
    here = Path(__file__).parent
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", help="Spotify Tracks Dataset CSV (comparison genres)")
    p.add_argument("--afrobeats", help="modern Afrobeats CSV (beatsofafro.csv)")
    p.add_argument("--out", default=here.parent / "data" / "insights.json")
    args = p.parse_args()
    try:
        ins = run(args.csv, args.out, args.afrobeats)
    except ValueError as e:
        sys.exit(f"error: {e}")
    hm, gm = ins["hitModel"], ins["genreModel"]
    print(f"✔ {ins['afrobeat']['tracks']} {ins['targetLabel']} tracks · {len(ins['eras'])} eras")
    print(f"  features: {', '.join(hm['browserModel']['features'])}")
    print(f"  hit model AUC: logistic {hm['cvAuc']['logisticRegression']['mean']} · forest {hm['cvAuc']['randomForest']['mean']}")
    print(f"  afrobeats-ness AUC: {gm['cvAuc']['mean']} vs {', '.join(gm['against'])}")
    print(f"  wrote {args.out}")


if __name__ == "__main__":
    main()
