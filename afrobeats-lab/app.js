/* Afrobeats Lab dashboard. Reads data/insights.json produced by pipeline/analyze.py. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const GENRE_COLORS = { afrobeat: "#1fc46b", afrobeats: "#1fc46b", pop: "#f2b43a", "hip-hop": "#8b5cf6", dancehall: "#38bdf8", reggaeton: "#fb7185",
    "r-n-b": "#e879f9", latin: "#f97316", "k-pop": "#a3e635", house: "#94a3b8", reggae: "#facc15" };
  const LABELS = { danceability: "Danceability", energy: "Energy", valence: "Happiness", acousticness: "Acoustic",
    speechiness: "Speechiness", tempo: "Tempo", instrumentalness: "Instrumental", liveness: "Live feel", loudness: "Loudness" };

  let D, T, compare = new Set(["pop"]);

  function canvas(el, h) {
    const dpr = window.devicePixelRatio || 1, w = el.clientWidth;
    el.width = w * dpr; el.height = h * dpr; el.style.height = h + "px";
    const ctx = el.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  // ---------- models (same maths as sklearn's StandardScaler + LogisticRegression) ----------
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const predict = (m, x) => sigmoid(m.intercept + m.coef.reduce((s, c, i) => s + (c * (x[i] - m.mean[i])) / m.scale[i], 0));

  function nearest(x, k = 5) {
    const m = D.hitModel.browserModel;
    const z = (v) => v.map((val, i) => (val - m.mean[i]) / m.scale[i]);
    const zx = z(x);
    return D.similar.tracks
      .map((t) => ({ t, d: Math.hypot(...z(t.v).map((v, i) => v - zx[i])) }))
      .sort((a, b) => a.d - b.d).slice(0, k);
  }

  // ---------- Hit Lab ----------
  const sliderState = {};
  function initSliders() {
    const feats = D.hitModel.browserModel.features;
    $("sliders").innerHTML = feats.map((f) => {
      const [lo, hi] = D.sliderRanges[f];
      const step = f === "tempo" ? 1 : "any";
      const mid = D.hitModel.browserModel.mean[feats.indexOf(f)];
      sliderState[f] = mid;
      return `<div class="slider"><label for="s-${f}">${LABELS[f]}<span id="v-${f}"></span></label>
        <input type="range" id="s-${f}" data-f="${f}" min="${lo}" max="${hi}" step="${step}" value="${mid}"></div>`;
    }).join("");
    $("sliders").addEventListener("input", (e) => {
      if (!e.target.dataset.f) return;
      sliderState[e.target.dataset.f] = Number(e.target.value);
      updateLab();
    });
    updateLab();
  }

  function updateLab() {
    const feats = D.hitModel.browserModel.features;
    const x = feats.map((f) => sliderState[f]);
    feats.forEach((f) => ($("v-" + f).textContent = f === "tempo" ? Math.round(sliderState[f]) + " BPM" : sliderState[f].toFixed(2)));
    const p = predict(D.hitModel.browserModel, x);
    const a = predict(D.genreModel.browserModel, x);
    $("hitPct").textContent = Math.round(p * 100) + "%";
    $("hitPct").style.color = p > 0.6 ? "var(--green)" : p > 0.35 ? "var(--gold)" : "var(--red)";
    drawGauge(p);
    $("afroBar").style.width = a * 100 + "%";
    $("afroPct").textContent = Math.round(a * 100) + "%";
    $("similar").innerHTML = nearest(x).map(({ t }) =>
      `<li><div><b>${esc(t.name)}</b><br><span>${esc(t.artist)}</span></div><span>pop ${t.popularity}</span></li>`).join("");
  }

  function drawGauge(p) {
    const { ctx, w } = canvas($("gauge"), 110);
    const cx = w / 2, cy = 100, r = 86;
    ctx.lineWidth = 14; ctx.lineCap = "round";
    ctx.strokeStyle = "#1f2823"; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.stroke();
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    g.addColorStop(0, "#ff5d5d"); g.addColorStop(0.5, "#f2b43a"); g.addColorStop(1, "#1fc46b");
    ctx.strokeStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * Math.max(0.01, p)); ctx.stroke();
  }

  // ---------- charts ----------
  function drawRadar() {
    const ALL = { danceability: "Dance", energy: "Energy", valence: "Happy", acousticness: "Acoustic", speechiness: "Speech", tempo_n: "Tempo", loudness_n: "Loud" };
    const axes = Object.keys(ALL).filter((k) => D.genres[T][k] != null);
    const names = axes.map((k) => ALL[k]);
    const { ctx, w, h } = canvas($("radar"), 320);
    const cx = w / 2, cy = h / 2 + 4, R = Math.min(w, h) / 2 - 40;
    const pt = (i, v) => { const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
    ctx.strokeStyle = "#1f2823"; ctx.lineWidth = 1;
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath(); axes.forEach((_, i) => { const [x, y] = pt(i, ring / 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = "#8fa197"; ctx.font = "12px -apple-system, Inter, sans-serif"; ctx.textAlign = "center";
    axes.forEach((_, i) => { const [x, y] = pt(i, 1.17); ctx.fillText(names[i], x, y + 4); });
    const draw = (g, fill) => {
      const prof = D.genres[g]; if (!prof) return;
      const c = GENRE_COLORS[g] || "#fff";
      ctx.beginPath(); axes.forEach((a, i) => { const [x, y] = pt(i, prof[a]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
      ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.stroke();
      if (fill) { ctx.globalAlpha = 0.18; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1; }
    };
    compare.forEach((g) => draw(g, false));
    draw(T, true);
  }

  function drawTempo() {
    const { edges, counts } = D.afrobeat.tempoHist;
    const { ctx, w, h } = canvas($("tempo"), 200);
    const max = Math.max(...counts, 1), pad = 22, bw = (w - 10) / counts.length;
    ctx.font = "11px -apple-system, Inter, sans-serif"; ctx.fillStyle = "#8fa197"; ctx.textAlign = "center";
    counts.forEach((c, i) => {
      const bh = (c / max) * (h - pad - 10);
      const peak = c === max;
      ctx.fillStyle = peak ? "#1fc46b" : "#2a3a30";
      ctx.fillRect(5 + i * bw + 2, h - pad - bh, bw - 4, bh);
      if (i % 2 === 0) { ctx.fillStyle = "#8fa197"; ctx.fillText(edges[i], 5 + i * bw, h - 6); }
    });
  }

  function hbars(el, entries, { min = 0, max = 1, fmt = (v) => v.toFixed(2), signed = false } = {}) {
    el.innerHTML = entries.map(([k, v]) => {
      const span = max - min;
      const style = signed
        ? (v >= 0 ? `left:50%;width:${(v / span) * 100}%;background:var(--green)` : `left:${50 + (v / span) * 100}%;width:${(-v / span) * 100}%;background:var(--red)`)
        : `left:0;width:${((v - min) / span) * 100}%;background:var(--green)`;
      return `<div class="hbar"><span>${LABELS[k] || k}</span><div class="track"><i style="${style}"></i></div><span class="v">${fmt(v)}</span></div>`;
    }).join("");
  }

  // ---------- render ----------
  function render() {
    const a = D.afrobeat;
    const stats = [[D.targetLabel + " tracks", a.tracks.toLocaleString()], ["Median tempo", Math.round(a.medianTempo) + " BPM"],
      ["Median popularity", a.medianPopularity], ["In a major key", a.majorShare != null ? Math.round(a.majorShare * 100) + "%" : "–"]];
    $("stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");

    const others = Object.keys(D.genres).filter((g) => g !== T);
    $("genreChips").innerHTML = `<span class="chip on" style="border-color:${GENRE_COLORS[T]}">${T}</span>` +
      others.map((g) => `<button class="chip ${compare.has(g) ? "on" : ""}" data-g="${g}" style="${compare.has(g) ? "border-color:" + GENRE_COLORS[g] : ""}">${g}</button>`).join("");
    drawRadar(); drawTempo();

    const imp = Object.entries(D.hitModel.featureImportance);
    hbars($("importance"), imp, { max: Math.max(...imp.map((e) => e[1])), fmt: (v) => Math.round(v * 100) + "%" });
    const corr = Object.entries(a.popularityCorrelation).sort((x, y) => y[1] - x[1]);
    const cmax = Math.max(0.2, ...corr.map((e) => Math.abs(e[1]))) * 2;
    hbars($("corr"), corr, { min: -cmax / 2, max: cmax / 2, signed: true, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(2) });

    const hm = D.hitModel, gm = D.genreModel;
    $("modelCard").innerHTML = `
      <p><b>Hit predictor.</b> Target: ${esc(hm.label)}. ${hm.samples} tracks, ${hm.positives} hits.</p>
      <p>5-fold cross-validated ROC AUC: logistic regression <b>${hm.cvAuc.logisticRegression.mean}</b> ± ${hm.cvAuc.logisticRegression.std},
      random forest <b>${hm.cvAuc.randomForest.mean}</b> ± ${hm.cvAuc.randomForest.std}. (0.5 = coin flip.)</p>
      <p style="margin-top:8px"><b>Afrobeats-ness.</b> ${D.targetLabel} vs ${gm.against.join(", ")}. AUC <b>${gm.cvAuc.mean}</b>.</p>
      <p style="margin-top:8px">Audio features only, no marketing, features or label budget. So treat it as a fun signal, not a crystal ball.</p>`;

    $("topTracks").innerHTML = a.topTracks.map((t) =>
      `<tr><td><b>${esc(t.track_name)}</b><br><span style="color:var(--muted);font-size:12px">${esc(String(t.artists).replace(/;/g, ", "))}</span></td><td class="n">${t.popularity}</td></tr>`).join("");
    $("topArtists").innerHTML = a.topArtists.map((t) =>
      `<tr><td>${esc(t.artist)} <span style="color:var(--muted);font-size:12px">· ${t.tracks} tracks</span></td><td class="n">${t.avgPopularity}</td></tr>`).join("");
    renderEras();
    $("source").textContent = "data: " + D.source + " · generated " + D.generated;
  }

  // ---------- eras ----------
  function renderEras() {
    const E = D.eras || [];
    $("erasCard").classList.toggle("hidden", E.length < 2);
    if (E.length < 2) return;
    const lines = [["danceability", "#1fc46b", "Dance"], ["energy", "#f2b43a", "Energy"], ["valence", "#38bdf8", "Happy"], ["speechiness", "#e879f9", "Speech"]]
      .filter(([k]) => E[0][k] != null);
    const { ctx, w, h } = canvas($("eraChart"), 220);
    const pad = { l: 40, r: 30, t: 10, b: 26 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = (i) => pad.l + (E.length === 1 ? iw / 2 : (i / (E.length - 1)) * iw), y = (v) => pad.t + (1 - v) * ih;
    ctx.font = "11px -apple-system, Inter, sans-serif"; ctx.fillStyle = "#8fa197"; ctx.strokeStyle = "#1f2823";
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(v, pad.l - 6, y(v) + 4); });
    ctx.textAlign = "center";
    E.forEach((e, i) => { const yr = (e.era.match(/(19|20)\d{2}/g) || [e.era]); ctx.fillText(yr.join("–").replace(/(\d{2})(\d{2})–\1/, "$1$2–"), x(i), h - 8); });
    lines.forEach(([k, c]) => {
      ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.beginPath();
      E.forEach((e, i) => (i ? ctx.lineTo(x(i), y(e[k])) : ctx.moveTo(x(i), y(e[k])))); ctx.stroke();
      E.forEach((e, i) => { ctx.beginPath(); ctx.arc(x(i), y(e[k]), 3.5, 0, 7); ctx.fillStyle = c; ctx.fill(); });
    });
    $("eraLegend").innerHTML = lines.map(([, c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
    $("eraTable").innerHTML = `<tr><td style="color:var(--muted)">Era</td><td class="n">Tempo</td><td class="n">Pop.</td></tr>` +
      E.map((e) => `<tr><td><b>${esc(e.era)}</b><br><span style="color:var(--muted);font-size:12px">${esc(e.topTrack)} · ${e.tracks} tracks</span></td><td class="n">${e.tempo ? Math.round(e.tempo) : "–"}</td><td class="n">${e.popularity}</td></tr>`).join("");
  }

  $("genreChips").addEventListener("click", (e) => {
    const g = e.target.dataset && e.target.dataset.g; if (!g) return;
    compare.has(g) ? compare.delete(g) : compare.add(g);
    render();
  });
  window.addEventListener("resize", () => D && (drawRadar(), drawTempo(), renderEras(), updateLab()));

  fetch("data/insights.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("missing"); return r.json(); })
    .then((d) => { D = d; T = d.target || "afrobeat"; d.targetLabel = d.targetLabel || "Afrobeat"; d.eras = d.eras || []; document.querySelectorAll("[data-tl]").forEach((el) => (el.textContent = d.targetLabel || "Afrobeat")); $("dash").classList.remove("hidden"); render(); initSliders(); })
    .catch(() => $("setup").classList.remove("hidden"));
})();
