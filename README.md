# 🇳🇬 Naija Mini Apps

![tests](https://github.com/YOUR-USERNAME/naija-mini-apps/actions/workflows/tests.yml/badge.svg)

Five Lagos-flavoured projects, each one showing a different skill: a scoring engine, a financial simulation, a live full-stack API, and a data/ML pipeline.

**Live:** https://YOUR-USERNAME.github.io/naija-mini-apps/

| Project | What it is | Skills |
| --- | --- | --- |
| 📈 [MOTION](motion/) | Who's moving in Naija music, measured daily. Tracks Nigeria's underground (UG) wave (Mavo, Zaylevelten, scottyolorin, Egertton…) vs mainstream acts every day: Spotify monthly listeners, daily streams, climbing songs, a who-features-whom network, UG → mainstream crossovers and "names to watch". Artist list is one editable JSON file. | **Python** data collection (Spotify Web API, HTML parsing), scheduled **GitHub Actions** pipeline that commits data daily, time-series analysis, force-directed network graph in Canvas |
| 🚗 [Why I'm Late](late/) | Excuse engine. Ranks 20+ excuses against your route (island ↔ mainland, tolls, expressways), transport, rush hour, rain, how late you are, and how often you've used each one this week. Manager suspicion meter, share-card image. | Rule-based scoring model, seeded RNG, state persistence, Canvas |
| 💸 [Detty December Planner](detty/) | Day-by-day cash-flow simulation from Dec 1 to Jan 31 with payday, daily spend and every event. Finds your broke date, January runway, and the cheapest events to cancel so you never go below zero. Interactive chart, category donut, import/export, share card. | Simulation, optimisation (greedy/single-swap search), custom Canvas charts with no chart library |
| 🍛 [Jollof Wars](jollof-wars/) | Live global vote, Nigeria vs Ghana. One vote per device (changeable), per-IP limits, live results over Server-Sent Events, 24h timeline, country breakdown. | **Python** (Starlette/ASGI + Uvicorn), SQLite, REST API design, validation, token-bucket rate limiting, salted IP hashing, SSE, CORS, deploy config |
| 🎧 [Afrobeats Lab](afrobeats-lab/) | What makes an Afrobeats hit? Pandas analysis of Spotify audio features, Afrobeat vs other genres, and two scikit-learn models (logistic regression vs random forest, 5-fold CV ROC AUC). The model runs live in the browser: design a track with sliders, get a hit probability and the closest real songs. | **Python**, Pandas, NumPy, scikit-learn, model evaluation, exporting a model to JavaScript |

## MOTION (UG Wave Tracker) setup

1. Create an app at developer.spotify.com (Web API). The owner account needs Premium.
2. Locally: create `motion/collector/.env` with
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```
   then `cd motion/collector && python3 collect.py`. It's standard library only, so there's nothing to install.
3. On GitHub: Settings → Secrets and variables → Actions → add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. The `ug-tracker daily` workflow then runs every morning and commits the new numbers.
4. Edit `motion/artists.json` to add or remove artists.

Note: since Feb 2026 Spotify's API no longer returns follower/popularity data to development-mode apps, so daily numbers come from kworb.net (streams) and the public open.spotify.com artist page (monthly listeners). Set the Actions variable `ENABLE_WEB_SCRAPE=0` to turn the open.spotify.com part off.

## Structure

```
late/             excuse engine (engine.js = pure logic, app.js = UI)
detty/            planner (model.js = simulation, charts.js = canvas, app.js = UI)
jollof-wars/      frontend + backend/ (Python API, tests)
afrobeats-lab/    dashboard + pipeline/ (Python analysis, tests)
motion/       dashboard + collector/ (Python, tests) + artists.json + data/
tests/            Node tests for the JS engines
render.yaml       one-click deploy for the Jollof Wars API
```

## Tests

```bash
node --test tests/*.test.js                                   # JS engines
cd jollof-wars/backend && pip install -r requirements.txt pytest && pytest
cd afrobeats-lab/pipeline && pip install -r requirements.txt pytest && pytest
```

GitHub Actions runs all three on every push.

## Run locally

Open the folder in VS Code and use the **Live Server** extension. Jollof Wars needs its API running:

```bash
cd jollof-wars/backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Then open `jollof-wars/?api=http://localhost:8000`.

## Afrobeats Lab data

Download the free **Spotify Tracks Dataset** (maharshipandya) from Kaggle or Hugging Face, save it as `afrobeats-lab/pipeline/data/dataset.csv`, then:

```bash
cd afrobeats-lab/pipeline
pip install -r requirements.txt
python analyze.py data/dataset.csv     # writes afrobeats-lab/data/insights.json
```

Built by [@Aded0yin_](https://x.com/Aded0yin_)
