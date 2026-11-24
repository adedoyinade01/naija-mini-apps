/* MOTION dashboard (UG Wave Tracker). Reads data/ug.json written by collector/collect.py (plain-English layer in insights.py). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = ["#1fc46b", "#f2b43a", "#38bdf8", "#e879f9", "#fb7185", "#a3e635", "#f97316", "#8b5cf6"];
  const fmt = (n) => n == null ? "–" : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + "M"
    : Math.abs(n) >= 1e4 ? Math.round(n / 1e3) + "K" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1).replace(".0", "") + "K" : String(n);
  const fdate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
  const fdateY = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

  let D, filter = "all", sortKey = "listeners", mode = "pct";
  const picked = new Set();

  function canvas(el, h) {
    const dpr = window.devicePixelRatio || 1, w = el.clientWidth || 110;
    el.width = w * dpr; el.height = h * dpr; el.style.height = h + "px";
    const ctx = el.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "11px -apple-system, Inter, sans-serif";
    return { ctx, w, h };
  }
  const avatar = (a, size = 46) => a.image
    ? `<img class="avatar" src="${esc(a.image)}" alt="" loading="lazy" style="width:${size}px;height:${size}px">`
    : `<span class="avatar" style="width:${size}px;height:${size}px">${esc(a.name[0])}</span>`;
  const gainText = (a) => {
    if (a.listenersGained == null) return `<span class="flat">growth shows from day 2</span>`;
    if (!a.listenersGained || a.listenersChange === 0) return `<span class="flat">steady since ${fdate(a.changeSince)}</span>`;
    const up = a.listenersGained > 0;
    return `<span class="${up ? "up" : "down"}">${up ? "+" : "−"}${fmt(Math.abs(a.listenersGained))} listeners (${up ? "+" : ""}${a.listenersChange}%)</span> <span class="flat">since ${fdate(a.changeSince)}</span>`;
  };

  // ---------- story ----------
  function renderStory() {
    const names = D.artists.map((a) => a.name).concat(D.namesToWatch.map((n) => n.name)).sort((a, b) => b.length - a.length);
    const bold = (t) => names.reduce((s, n) => s.split(n).join(`\u0000${n}\u0001`), esc(t)).replace(/\u0000/g, "<b>").replace(/\u0001/g, "</b>");
    $("story").innerHTML = D.story.map((s) => `<li><span>${bold(s)}</span></li>`).join("");
    $("updated").textContent = "· updated " + fdateY(D.updated);
  }

  // ---------- cards ----------
  function sorted() {
    const list = D.artists.filter((a) => filter === "all" || a.group === filter);
    const key = {
      listeners: (a) => a.listeners ?? -1,
      change: (a) => (a.listeners || 0) >= 10000 ? a.listenersChange ?? -999 : -999,
      gained: (a) => a.listenersGained ?? -Infinity,
      meter: (a) => a.meter ? a.meter.score : -1,
    }[sortKey];
    return [...list].sort((a, b) => key(b) - key(a));
  }

  function renderCards() {
    $("filters").innerHTML = [["all", "All"], ...D.groups.map((g) => [g, g === "UG" ? "UG" : g[0].toUpperCase() + g.slice(1)])]
      .map(([k, l]) => `<button class="chip ${k === filter ? "on" : ""}" data-f="${k}">${l}</button>`).join("");
    $("cards").innerHTML = sorted().map((a) => `
      <button class="acard" data-id="${a.id}">
        <div class="top">${avatar(a)}<div><div class="nm">${esc(a.name)}</div><span class="pill ${esc(a.group)}">${esc(a.group)}</span></div>
          <span class="status s-${a.status.key}">${a.status.icon} ${a.status.label}</span></div>
        <div class="big"><div><b>${fmt(a.listeners)}</b><span>monthly listeners</span></div><canvas data-spark="${a.id}"></canvas></div>
        <div class="gain">${gainText(a)}</div>
        ${a.meter ? `<div><div class="meterlbl"><span>UG → Mainstream motion</span><b>${a.meter.label} · ${a.meter.score}</b></div><div class="meterbar"><i style="width:${a.meter.score}%"></i></div></div>` : ""}
        ${newDrop(a)}
        ${a.comparison ? `<div class="oneline">${esc(a.comparison[0].toUpperCase() + a.comparison.slice(1))}</div>` : ""}
      </button>`).join("");
    document.querySelectorAll("[data-spark]").forEach((c) => spark(c, D.artists.find((a) => a.id === c.dataset.spark)));
  }

  function newDrop(a) {
    const l = a.songs && a.songs.latest;
    if (!l) return "";
    const days = (new Date(D.updated) - new Date(l.date)) / 864e5;
    if (days > 30 || days < 0) return "";
    return `<div class="newdrop">🆕 New ${esc(l.type || "release")}: "${esc(l.name)}" · ${fdate(l.date)}${l.daily ? ` · ${fmt(l.daily)} plays/day` : ""}</div>`;
  }

  function songRow(t, showFeat) {
    const ch = t.change == null ? "" : `<span class="${t.change >= 0 ? "up" : "down"}">${t.change >= 0 ? "▲" : "▼"} ${Math.abs(t.change)}%</span>`;
    if (t.total == null) return `<li><div>${esc(t.title)}<small>streams not public yet</small></div><div class="r"><small>–</small></div></li>`;
    return `<li><div>${esc(t.title)}<small>${fmt(t.total)} total plays${t.gained ? ` · +${fmt(t.gained)} since ${fdate(t.since)}` : ""}</small></div>
      <div class="r"><b>${fmt(t.daily)}</b>/day<small>${ch || "&nbsp;"}</small></div></li>`;
  }

  function songsSection(a) {
    const s = a.songs || {};
    let h = "";
    if (s.latest) {
      const l = s.latest;
      h += `<h3 style="margin-top:18px">Latest release</h3>
        <p class="hint" style="margin:2px 0 0"><b style="color:var(--text)">"${esc(l.name)}"</b> · ${esc(l.type || "release")} · ${fdateY(l.date)}${l.charting && l.daily ? ` · <span class="up">${fmt(l.daily)} plays a day</span>` : ""}</p>
        <ul class="songs">${l.tracks.map((t) => songRow(t)).join("")}</ul>
        ${l.charting ? "" : `<p class="hint" style="margin-top:6px">Spotify doesn't publish song streams for ${esc(a.name)} yet. They appear here automatically once they chart on kworb.</p>`}`;
    }
    if (s.top && s.top.length) {
      h += `<h3 style="margin-top:18px">Most-streamed songs</h3><ul class="songs">${s.top.map((t) => songRow(t)).join("")}</ul>`;
    }
    if (s.features && s.features.length) {
      h += `<h3 style="margin-top:18px">Biggest features & collabs</h3><p class="hint" style="margin:2px 0 0">Songs where ${esc(a.name)} is the featured artist.</p><ul class="songs">${s.features.map((t) => songRow(t)).join("")}</ul>`;
    }
    if (!s.charting && !s.latest) h += `<h3 style="margin-top:18px">Songs</h3><p class="hint">Song data appears once Spotify's catalog and stream charts include ${esc(a.name)}.</p>`;
    return h;
  }

  function spark(el, a) {
    const pts = a.series.map((s) => s[1]).filter((v) => v != null);
    const { ctx, w, h } = canvas(el, 36);
    if (pts.length < 2) { ctx.fillStyle = "#3a4a40"; ctx.fillRect(0, h / 2, w, 2); return; }
    const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
    const up = pts[pts.length - 1] >= pts[0];
    ctx.strokeStyle = pts[pts.length - 1] === pts[0] ? "#5b6b62" : up ? "#1fc46b" : "#ff5d5d"; ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((v, i) => { const x = 2 + (i / (pts.length - 1)) * (w - 4), y = h - 4 - ((v - min) / span) * (h - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }

  // ---------- debates ----------
  function renderDebates() {
    $("debateWrap").classList.toggle("hidden", !D.debates.length);
    $("debates").innerHTML = D.debates.map((d) => `
      <section class="card debate">
        <div class="q">${esc(d.question)}</div>
        <div class="sides">
          <div class="side"><h4 style="color:var(--green)">✊ Still UG</h4><ul>${d.still.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
          <div class="side"><h4 style="color:var(--gold)">🎓 Graduated</h4><ul>${d.graduated.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn" data-poll="${esc(d.name)}">Ask my followers on X</button><button class="btn ghost" data-open="${d.id}">See ${esc(d.name)}'s numbers</button></div>
      </section>`).join("");
  }

  // ---------- detail sheet ----------
  function openArtist(id) {
    const a = D.artists.find((x) => x.id === id); if (!a) return;
    const streams = a.dailyStreams != null
      ? `<b>${fmt(a.dailyStreams)}</b><small>plays a day across their songs</small>`
      : `<b style="font-size:15px">Not on the charts yet</b><small>Spotify doesn't publish streams for smaller artists</small>`;
    $("sheet").innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <div class="top">${avatar(a, 56)}<div><h2>${esc(a.name)}</h2><span class="pill ${esc(a.group)}">${esc(a.group)}</span></div></div>
      <p style="margin-top:14px;font-size:16px">${esc(a.summary)}.</p>
      <div class="kv">
        <div><span>Monthly listeners</span><b>${fmt(a.listeners)}</b><small>${a.status.icon} ${a.status.label}</small></div>
        <div><span>New listeners</span><b>${a.listenersGained == null ? "–" : (a.listenersGained > 0 ? "+" : "") + fmt(a.listenersGained)}</b><small>${a.changeSince ? "since " + fdate(a.changeSince) : "from day 2"}${a.gainedPerDay && a.changeDays > 1 ? ` · ~${fmt(a.gainedPerDay)}/day` : ""}</small></div>
        <div><span>Daily streams</span>${streams}</div>
        <div><span>Rank</span><b>#${[...D.artists].sort((x, y) => (y.listeners || 0) - (x.listeners || 0)).findIndex((x) => x.id === a.id) + 1}</b><small>of ${D.artists.filter((x) => x.listeners).length} tracked</small></div>
      </div>
      <h3>Listeners over time</h3><canvas id="sheetChart" class="chart"></canvas>
      ${a.meter ? `<h3 style="margin-top:18px">UG → Mainstream motion: ${a.meter.label} (${a.meter.score}/100)</h3>
        <div class="meterbar" style="margin:8px 0 10px"><i style="width:${a.meter.score}%"></i></div>
        <ul class="hint" style="padding-left:18px;display:grid;gap:4px;margin:0">${a.meter.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      ${a.debate ? `<h3 style="margin-top:18px">${esc(a.debate.question)}</h3><div class="sides" style="margin-top:8px">
        <div class="side"><h4 style="color:var(--green)">✊ Still UG</h4><ul>${a.debate.still.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
        <div class="side"><h4 style="color:var(--gold)">🎓 Graduated</h4><ul>${a.debate.graduated.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div></div>` : ""}
      ${songsSection(a)}
      <h3 style="margin-top:18px">Works with</h3>
      ${a.collaborators.length ? `<div class="collabs">${a.collaborators.map((c) => `<span class="${esc(c.group)}">${esc(c.name)} · ${c.songs}</span>`).join("")}</div>`
        : `<p class="hint">Features load from Spotify's catalog, usually within a day of adding an artist.</p>`}
      <div class="row" style="margin-top:18px">
        <a class="btn" href="https://open.spotify.com/artist/${esc(a.id)}" target="_blank" rel="noopener">Open on Spotify</a>
        <button class="btn ghost" data-share="${a.id}">Share on X</button>
      </div>`;
    $("overlay").classList.add("open");
    document.body.style.overflow = "hidden";
    lineChart($("sheetChart"), [{ name: a.name, color: "#1fc46b", pts: a.series.filter((s) => s[1] != null).map((s) => [s[0], s[1]]) }], "abs", 180);
  }
  function closeSheet() { $("overlay").classList.remove("open"); document.body.style.overflow = ""; }

  // ---------- charts ----------
  function lineChart(el, lines, m, height) {
    const { ctx, w, h } = canvas(el, height);
    const dates = [...new Set(lines.flatMap((l) => l.pts.map((p) => p[0])))].sort();
    if (dates.length < 2) { ctx.fillStyle = "#8fa197"; ctx.textAlign = "center"; ctx.fillText("The line appears from the second day of data.", w / 2, h / 2); return; }
    const L = lines.map((l) => { const base = l.pts[0] ? l.pts[0][1] : 1; return { ...l, v: l.pts.map(([d, v]) => [dates.indexOf(d), m === "pct" ? (100 * (v - base)) / base : v]) }; });
    const vals = L.flatMap((l) => l.v.map((p) => p[1]));
    let min = Math.min(...vals, m === "pct" ? 0 : Infinity), max = Math.max(...vals, m === "pct" ? 0 : -Infinity);
    if (min === max) { const pad = m === "pct" ? 1 : Math.max(1, min * 0.01); min -= pad; max += pad; }
    const pad = { l: 52, r: 36, t: 10, b: 24 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = (i) => pad.l + (i / (dates.length - 1)) * iw, y = (v) => pad.t + (1 - (v - min) / (max - min)) * ih;
    ctx.strokeStyle = "#1f2823"; ctx.fillStyle = "#8fa197";
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3;
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(m === "pct" ? v.toFixed(1) + "%" : (max - min < 2e5 && max >= 1e6 ? (v / 1e6).toFixed(2) + "M" : fmt(Math.round(v))), pad.l - 6, y(v) + 4);
    }
    ctx.textAlign = "center";
    [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])].forEach((i) => ctx.fillText(fdate(dates[i]), x(i), h - 6));
    L.forEach((l) => {
      ctx.strokeStyle = l.color; ctx.lineWidth = 2.5; ctx.beginPath();
      l.v.forEach(([i, v], k) => (k ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)))); ctx.stroke();
      l.v.forEach(([i, v]) => { ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, 7); ctx.fillStyle = l.color; ctx.fill(); });
    });
  }

  function renderCompare() {
    $("pickers").innerHTML = [...D.artists].sort((a, b) => (b.listeners || 0) - (a.listeners || 0)).map((a) => {
      const i = [...picked].indexOf(a.id);
      return `<button class="chip ${i >= 0 ? "on" : ""}" data-pick="${a.id}" style="${i >= 0 ? `border-color:${COLORS[i % COLORS.length]};color:${COLORS[i % COLORS.length]}` : ""}">${esc(a.name)}</button>`;
    }).join("");
    const lines = [...picked].map((id, i) => {
      const a = D.artists.find((x) => x.id === id);
      return { name: a.name, color: COLORS[i % COLORS.length], pts: a.series.filter((s) => s[1] != null).map((s) => [s[0], s[1]]) };
    });
    lineChart($("growth"), lines, mode, 240);
  }

  function renderShare() {
    const S = D.groupSeries.filter((p) => p.UGListeners != null && p.mainstreamListeners != null);
    const { ctx, w, h } = canvas($("share"), 170);
    if (!S.length) { ctx.fillStyle = "#8fa197"; ctx.textAlign = "center"; ctx.fillText("No data yet", w / 2, h / 2); return; }
    const vals = S.map((p) => (100 * p.UGListeners) / (p.UGListeners + p.mainstreamListeners));
    const pad = { l: 36, r: 12, t: 10, b: 22 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = Math.max(5, Math.ceil(Math.max(...vals) / 5) * 5);
    const x = (i) => pad.l + (S.length === 1 ? iw / 2 : (i / (S.length - 1)) * iw), y = (v) => pad.t + (1 - v / max) * ih;
    ctx.fillStyle = "#8fa197"; ctx.strokeStyle = "#1f2823";
    [0, max / 2, max].forEach((v) => { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(v + "%", pad.l - 6, y(v) + 4); });
    ctx.strokeStyle = "#1fc46b"; ctx.lineWidth = 2.5; ctx.beginPath(); vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)))); ctx.stroke();
    vals.forEach((v, i) => { ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, 7); ctx.fillStyle = "#1fc46b"; ctx.fill(); });
    const last = vals[vals.length - 1], first = vals[0];
    $("shareNote").textContent = S.length > 1 ? `${last.toFixed(1)}% now, vs ${first.toFixed(1)}% on ${fdate(S[0].date)}.` : `${last.toFixed(1)}% of all monthly listeners we track.`;
  }

  function renderLists() {
    const empty = (t) => `<li><span style="color:var(--muted)">${t}</span></li>`;
    $("crossovers").innerHTML = D.crossovers.length ? D.crossovers.map((c) => `
      <li><div><b>${esc(c.ug)} × ${esc(c.mainstream)}</b><small>"${esc(c.track)}"${c.tracks > 1 ? ` + ${c.tracks - 1} more` : ""}</small></div><div class="r"><small>${fdateY(c.date)}</small></div></li>`).join("") : empty("No UG × mainstream songs found yet.");
    $("watch").innerHTML = D.namesToWatch.length ? D.namesToWatch.map((n) => `
      <li><div><b>${esc(n.name)}</b><small>with ${esc(n.with.join(", "))}</small></div><div class="r">${n.tracks} songs<small>latest ${fdateY(n.latest)}</small></div></li>`).join("") : empty("Nobody new yet.");
    $("climbers").innerHTML = D.climbers.length ? D.climbers.map((c) => `
      <li><div><b>${esc(c.track)}</b><small>${esc(c.artist)}</small></div><div class="r">${c.new ? `<span class="up">NEW</span>` : c.change == null ? "" : `<span class="${c.change >= 0 ? "up" : "down"}">${c.change >= 0 ? "+" : ""}${c.change}%</span>`}<small>${fmt(c.daily)}/day</small></div></li>`).join("") : empty("Needs about a week of data.");
    $("releases").innerHTML = D.releases.length ? D.releases.slice(0, 10).map((r) => `
      <li><div><b>${esc(r.name)}</b><small>${esc(r.artist)} · ${esc(r.type || "")}</small></div><div class="r"><small>${fdateY(r.date)}</small></div></li>`).join("") : empty("Releases load from Spotify's catalog.");
  }

  // ---------- wiring ----------
  function share(text) { window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank"); }
  document.addEventListener("click", (e) => {
    const t = e.target;
    const card = t.closest("[data-id]"); if (card && card.classList.contains("acard")) return openArtist(card.dataset.id);
    if (t.closest("[data-open]")) return openArtist(t.closest("[data-open]").dataset.open);
    if (t.dataset.f) { filter = t.dataset.f; return renderCards(); }
    if (t.dataset.pick) { const id = t.dataset.pick; picked.has(id) ? picked.delete(id) : picked.size < 8 && picked.add(id); return renderCompare(); }
    if (t.dataset.mode) { mode = t.dataset.mode; document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === t)); return renderCompare(); }
    if (t.dataset.poll) return share(`is ${t.dataset.poll} still UG? 🤔 the numbers say they've crossed over, the streets say otherwise. what do you think?\n\nvia MOTION ${location.href}`);
    if (t.dataset.share) { const a = D.artists.find((x) => x.id === t.dataset.share); return share(`${a.name}: ${a.summary} 📈\n\nvia MOTION ${location.href}`); }
    if (t.classList.contains("close") || t.id === "overlay") closeSheet();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());
  $("sort").onchange = (e) => { sortKey = e.target.value; renderCards(); };
  window.addEventListener("resize", () => D && (renderCards(), renderCompare(), renderShare()));

  fetch("data/ug.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("missing"); return r.json(); })
    .then((d) => {
      if (!d.artists || !d.story) throw new Error("old format");
      D = d;
      const ug = d.artists.filter((a) => a.group === "UG" && a.listeners).sort((a, b) => b.listeners - a.listeners);
      const ms = d.artists.filter((a) => a.group === "mainstream" && a.listeners).sort((a, b) => a.listeners - b.listeners);
      [...ug.slice(0, 2), ...ms.slice(0, 1)].forEach((a) => picked.add(a.id));
      $("dash").classList.remove("hidden");
      renderStory(); renderCards(); renderDebates(); renderCompare(); renderShare(); renderLists();
    })
    .catch(() => $("setup").classList.remove("hidden"));
})();
