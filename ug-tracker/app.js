/* UG Wave Tracker dashboard. Reads data/ug.json written by collector/collect.py. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const GROUP_COLOR = { UG: "#1fc46b", mainstream: "#f2b43a", other: "#5b6b62" };
  const LINE_COLORS = ["#1fc46b", "#f2b43a", "#38bdf8", "#e879f9", "#fb7185", "#a3e635", "#f97316", "#8b5cf6"];
  const fmt = (n) => n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K" : String(n);
  const chg = (v) => v == null ? `<span class="flat">–</span>` : `<span class="${v > 0 ? "up" : v < 0 ? "down" : "flat"}">${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.abs(v)}%</span>`;
  const fdate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

  let D, filter = "all", sortKey = "listeners", sortDir = -1, mode = "pct";
  const selected = new Set();

  function canvas(el, h) {
    const dpr = window.devicePixelRatio || 1, w = el.clientWidth;
    el.width = w * dpr; el.height = h * dpr; el.style.height = h + "px";
    const ctx = el.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "11px -apple-system, Inter, sans-serif";
    return { ctx, w, h };
  }
  const tip = (e, html) => { const t = $("tip"); if (!html) { t.style.display = "none"; return; } t.innerHTML = html; t.style.display = "block"; t.style.left = e.clientX + 14 + "px"; t.style.top = e.clientY + 14 + "px"; };

  // ---------- headline ----------
  function renderStats() {
    const A = D.artists.filter((a) => a.listeners != null);
    const fastest = [...A].filter((a) => a.listenersChange != null).sort((a, b) => b.listenersChange - a.listenersChange)[0];
    const ug = A.filter((a) => a.group === "UG");
    const last = D.groupSeries[D.groupSeries.length - 1] || {};
    const share = last.UG != null && last.mainstream ? Math.round((100 * last.UG) / (last.UG + last.mainstream)) : null;
    const stats = [
      ["Artists tracked", D.artists.length, `${D.days} day${D.days === 1 ? "" : "s"} of data`],
      ["Fastest growing", fastest ? fastest.name : "–", fastest ? `${fastest.listenersChange > 0 ? "+" : ""}${fastest.listenersChange}% listeners` : "needs 2+ days"],
      ["Biggest UG act", ug[0] ? ug[0].name : "–", ug[0] ? fmt(ug[0].listeners) + " monthly listeners" : ""],
      ["UG share of streams", share != null ? share + "%" : "–", "of daily streams, latest"],
    ];
    $("stats").innerHTML = stats.map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join("");
  }

  // ---------- leaderboard ----------
  function renderBoard() {
    const groups = ["all", ...D.groups];
    $("filters").innerHTML = groups.map((g) => `<button class="chip ${g === filter ? "on" : ""}" data-f="${g}">${g === "all" ? "All" : g}</button>`).join("");
    const rows = D.artists.filter((a) => filter === "all" || a.group === filter).sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (sortKey === "name") return sortDir * String(x).localeCompare(String(y));
      return sortDir * ((x ?? -Infinity) - (y ?? -Infinity));
    });
    $("board").innerHTML = rows.map((a) => `
      <tr data-id="${a.id}" class="${selected.has(a.id) ? "sel" : ""}">
        <td><div class="who">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : `<span class="ph"></span>`}<span>${esc(a.name)}<span class="pill ${esc(a.group)}">${esc(a.group)}</span></span></div></td>
        <td>${fmt(a.listeners)}</td><td>${chg(a.listenersChange)}</td><td>${fmt(a.dailyStreams)}</td></tr>`).join("");
    const since = D.artists.find((a) => a.changeSince)?.changeSince;
    $("since").textContent = since ? `Change is since ${fdate(since)}.` : "Change appears after the second day of data.";
  }

  // ---------- growth chart ----------
  function renderGrowth() {
    const picks = D.artists.filter((a) => selected.has(a.id));
    const { ctx, w, h } = canvas($("growth"), 240);
    const dates = [...new Set(D.artists.flatMap((a) => a.series.map((s) => s[0])))].sort();
    if (dates.length < 2 || !picks.length) {
      ctx.fillStyle = "#8fa197"; ctx.textAlign = "center";
      ctx.fillText(dates.length < 2 ? "The chart fills in from the second day of data." : "Tap artists in the leaderboard to compare them.", w / 2, h / 2);
      $("growthLegend").innerHTML = ""; return;
    }
    const lines = picks.map((a, i) => {
      const pts = a.series.filter((s) => s[1] != null);
      const base = pts[0] ? pts[0][1] : null;
      return { a, color: LINE_COLORS[i % LINE_COLORS.length], pts: pts.map(([d, v]) => [dates.indexOf(d), mode === "pct" ? (100 * (v - base)) / base : v]) };
    });
    const vals = lines.flatMap((l) => l.pts.map((p) => p[1]));
    let min = Math.min(...vals, mode === "pct" ? 0 : Infinity), max = Math.max(...vals, mode === "pct" ? 0 : -Infinity);
    if (min === max) { min -= 1; max += 1; }
    const pad = { l: 52, r: 34, t: 10, b: 24 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = (i) => pad.l + (i / (dates.length - 1)) * iw, y = (v) => pad.t + (1 - (v - min) / (max - min)) * ih;
    ctx.strokeStyle = "#1f2823"; ctx.fillStyle = "#8fa197";
    for (let k = 0; k <= 4; k++) {
      const v = min + ((max - min) * k) / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(mode === "pct" ? v.toFixed(1) + "%" : fmt(Math.round(v)), pad.l - 6, y(v) + 4);
    }
    ctx.textAlign = "center";
    [0, Math.floor((dates.length - 1) / 2), dates.length - 1].forEach((i) => ctx.fillText(fdate(dates[i]).replace(/ \d{4}$/, ""), x(i), h - 6));
    lines.forEach((l) => {
      ctx.strokeStyle = l.color; ctx.lineWidth = 2.5; ctx.beginPath();
      l.pts.forEach(([i, v], k) => (k ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)))); ctx.stroke();
    });
    $("growthLegend").innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.a.name)}</span>`).join("");
  }

  // ---------- UG share ----------
  function renderShare() {
    const S = D.groupSeries.filter((p) => p.UG != null && p.mainstream != null);
    const { ctx, w, h } = canvas($("share"), 180);
    if (!S.length) { ctx.fillStyle = "#8fa197"; ctx.textAlign = "center"; ctx.fillText("No stream data yet", w / 2, h / 2); return; }
    const vals = S.map((p) => (100 * p.UG) / (p.UG + p.mainstream));
    const pad = { l: 36, r: 10, t: 10, b: 22 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = Math.max(5, Math.ceil(Math.max(...vals) / 5) * 5);
    const x = (i) => pad.l + (S.length === 1 ? iw / 2 : (i / (S.length - 1)) * iw), y = (v) => pad.t + (1 - v / max) * ih;
    ctx.fillStyle = "#8fa197"; ctx.strokeStyle = "#1f2823";
    [0, max / 2, max].forEach((v) => { ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(v + "%", pad.l - 6, y(v) + 4); });
    const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih); g.addColorStop(0, "rgba(31,196,107,.35)"); g.addColorStop(1, "rgba(31,196,107,0)");
    ctx.beginPath(); ctx.moveTo(x(0), y(0)); vals.forEach((v, i) => ctx.lineTo(x(i), y(v))); ctx.lineTo(x(vals.length - 1), y(0)); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = "#1fc46b"; ctx.lineWidth = 2.5; ctx.beginPath(); vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)))); ctx.stroke();
    vals.forEach((v, i) => { ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, 7); ctx.fillStyle = "#1fc46b"; ctx.fill(); });
    const first = vals[0], last = vals[vals.length - 1];
    $("shareNote").textContent = S.length > 1 ? `${last.toFixed(1)}% now vs ${first.toFixed(1)}% on ${fdate(S[0].date)}.` : `${last.toFixed(1)}% today.`;
  }

  // ---------- lists ----------
  function renderLists() {
    $("climbers").innerHTML = D.climbers.length ? D.climbers.map((c) => `
      <li><div><b>${esc(c.track)}</b><small>${esc(c.artist)}<span class="pill ${esc(c.group)}">${esc(c.group)}</span></small></div>
      <div class="r">${c.new ? `<span class="up">NEW</span>` : chg(c.change)}<small>${fmt(c.daily)}/day</small></div></li>`).join("")
      : `<li><span style="color:var(--muted)">Needs a week of data.</span></li>`;
    $("crossovers").innerHTML = D.crossovers.length ? D.crossovers.map((c) => `
      <li><div><b>${esc(c.ug)} × ${esc(c.mainstream)}</b><small>${esc(c.track)}${c.tracks > 1 ? ` + ${c.tracks - 1} more` : ""}</small></div><div class="r"><small>${fdate(c.date)}</small></div></li>`).join("")
      : `<li><span style="color:var(--muted)">No UG × mainstream songs found yet.</span></li>`;
    $("watch").innerHTML = D.namesToWatch.length ? D.namesToWatch.map((n) => `
      <li><div><b>${esc(n.name)}</b><small>with ${esc(n.with.join(", "))}</small></div><div class="r">${n.tracks} songs<small>latest ${fdate(n.latest)}</small></div></li>`).join("")
      : `<li><span style="color:var(--muted)">Nobody new yet.</span></li>`;
    $("releases").innerHTML = D.releases.length ? D.releases.slice(0, 12).map((r) => `
      <li><div><b>${esc(r.name)}</b><small>${esc(r.artist)}<span class="pill ${esc(r.group)}">${esc(r.group)}</span> · ${esc(r.type || "")}</small></div><div class="r"><small>${fdate(r.date)}</small></div></li>`).join("")
      : `<li><span style="color:var(--muted)">Releases load from the Spotify API.</span></li>`;
  }

  // ---------- collaboration network (force-directed) ----------
  let net = null;
  function layoutNetwork() {
    const { nodes, edges } = D.network;
    const N = nodes.map((n, i) => ({ ...n, x: Math.cos(i) * 100, y: Math.sin(i * 1.7) * 100, vx: 0, vy: 0, deg: 0 }));
    const idx = Object.fromEntries(N.map((n, i) => [n.id, i]));
    const E = edges.filter((e) => e.a in idx && e.b in idx).map((e) => ({ ...e, s: idx[e.a], t: idx[e.b] }));
    E.forEach((e) => { N[e.s].deg += e.weight; N[e.t].deg += e.weight; });
    for (let it = 0; it < 300; it++) {
      const k = 1 - it / 300;
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01;
        const f = 1800 / d2; dx *= f / Math.sqrt(d2); dy *= f / Math.sqrt(d2);
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
      E.forEach((e) => { const a = N[e.s], b = N[e.t]; const dx = b.x - a.x, dy = b.y - a.y; const f = 0.02 * Math.min(3, e.weight);
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; });
      N.forEach((n) => { n.vx -= n.x * 0.01; n.vy -= n.y * 0.01; n.x += n.vx * k * 0.5; n.y += n.vy * k * 0.5; n.vx *= 0.6; n.vy *= 0.6; });
    }
    net = { N, E, hover: null };
  }
  function drawNetwork() {
    if (!net) layoutNetwork();
    const { ctx, w, h } = canvas($("net"), 380);
    const { N, E } = net;
    if (!N.length || !E.length) { ctx.fillStyle = "#8fa197"; ctx.textAlign = "center"; ctx.fillText("The network loads from the Spotify API catalog.", w / 2, h / 2); return; }
    const xs = N.map((n) => n.x), ys = N.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((w - 80) / (maxX - minX || 1), (h - 50) / (maxY - minY || 1));
    N.forEach((n) => { n.sx = 40 + (n.x - minX) * s + ((w - 80) - (maxX - minX) * s) / 2; n.sy = 25 + (n.y - minY) * s + ((h - 50) - (maxY - minY) * s) / 2; n.r = 4 + Math.min(10, Math.sqrt(n.deg) * 2); });
    const hv = net.hover;
    E.forEach((e) => {
      const lit = hv != null && (e.s === hv || e.t === hv);
      ctx.strokeStyle = lit ? "rgba(238,243,239,.7)" : hv != null ? "rgba(143,161,151,.08)" : "rgba(143,161,151,.25)";
      ctx.lineWidth = Math.min(4, 0.8 + e.weight * 0.6);
      ctx.beginPath(); ctx.moveTo(N[e.s].sx, N[e.s].sy); ctx.lineTo(N[e.t].sx, N[e.t].sy); ctx.stroke();
    });
    N.forEach((n, i) => {
      const dim = hv != null && i !== hv && !E.some((e) => (e.s === hv && e.t === i) || (e.t === hv && e.s === i));
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.beginPath(); ctx.arc(n.sx, n.sy, n.r, 0, 7); ctx.fillStyle = GROUP_COLOR[n.group] || GROUP_COLOR.other; ctx.fill();
      if (n.group !== "other" || i === hv || n.deg >= 3) {
        ctx.fillStyle = "#eef3ef"; ctx.textAlign = "center"; ctx.font = (n.group !== "other" ? "600 " : "") + "11px -apple-system, Inter, sans-serif";
        ctx.fillText(n.name, n.sx, n.sy - n.r - 4);
      }
      ctx.globalAlpha = 1;
    });
  }
  function netHover(e) {
    if (!net) return;
    const r = $("net").getBoundingClientRect(), px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left, py = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    let best = null, bd = 400;
    net.N.forEach((n, i) => { const d = (n.sx - px) ** 2 + (n.sy - py) ** 2; if (d < bd) { bd = d; best = i; } });
    if (best !== net.hover) { net.hover = best; drawNetwork(); }
    if (best == null) return tip(e, null);
    const n = net.N[best];
    const links = net.E.filter((x) => x.s === best || x.t === best).map((x) => ({ o: net.N[x.s === best ? x.t : x.s].name, w: x.weight })).sort((a, b) => b.w - a.w);
    tip(e.touches ? e.touches[0] : e, `<b>${esc(n.name)}</b><br>${links.slice(0, 6).map((l) => `${esc(l.o)} · ${l.w} song${l.w > 1 ? "s" : ""}`).join("<br>")}`);
  }

  // ---------- wiring ----------
  function renderAll() { renderStats(); renderBoard(); renderGrowth(); renderShare(); renderLists(); drawNetwork(); }

  $("filters").onclick = (e) => { const f = e.target.dataset.f; if (f) { filter = f; renderBoard(); } };
  document.querySelector("thead").onclick = (e) => {
    const k = e.target.dataset.sort; if (!k) return;
    sortDir = sortKey === k ? -sortDir : k === "name" ? 1 : -1; sortKey = k; renderBoard();
  };
  $("board").onclick = (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const id = tr.dataset.id; selected.has(id) ? selected.delete(id) : selected.size < 8 && selected.add(id);
    renderBoard(); renderGrowth();
  };
  document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => {
    mode = b.dataset.mode; document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b)); renderGrowth();
  }));
  $("net").addEventListener("mousemove", netHover);
  $("net").addEventListener("touchstart", netHover, { passive: true });
  $("net").addEventListener("mouseleave", (e) => { if (net) { net.hover = null; drawNetwork(); } tip(e, null); });
  window.addEventListener("resize", () => D && (renderGrowth(), renderShare(), drawNetwork()));

  fetch("data/ug.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("missing"); return r.json(); })
    .then((d) => {
      D = d;
      if (!d.artists.some((a) => a.listeners != null || a.dailyStreams != null) && !d.network.edges.length) throw new Error("empty");
      // preselect the top 2 UG + top mainstream act
      [...d.artists.filter((a) => a.group === "UG").slice(0, 2), ...d.artists.filter((a) => a.group === "mainstream").slice(0, 1)].forEach((a) => selected.add(a.id));
      $("updated").textContent = "updated " + fdate(d.updated);
      $("dash").classList.remove("hidden");
      renderAll();
    })
    .catch(() => $("setup").classList.remove("hidden"));
})();
