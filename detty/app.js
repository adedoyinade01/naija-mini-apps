/* Detty December Planner: UI wiring. Model lives in model.js, drawing in charts.js. */
(function () {
  "use strict";
  const M = window.DettyModel, C = window.DettyCharts;
  const KEY = "detty-planner-v2";
  const $ = (id) => document.getElementById(id);
  const num = (s) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const PRESETS = [
    ["🎤 Concert", "concert", 60000, "2026-12-20"],
    ["🍾 Club night", "club", 50000, "2026-12-19"],
    ["👗 Owambe", "owambe", 40000, "2026-12-26"],
    ["🏖️ Beach day", "beach", 30000, "2026-12-26"],
    ["🥂 Brunch", "food", 20000, "2026-12-21"],
    ["🎁 Gifts", "family", 50000, "2026-12-24"],
    ["🎆 NYE party", "club", 80000, "2026-12-31"],
  ];

  let state = load();
  let days, summary;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage blocked, so use the demo */ }
    return M.defaultState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- render ----------
  function render() {
    days = M.simulate(state);
    summary = M.summarize(state, days);
    renderTiles();
    C.balanceChart($("chart"), days, { fmtDate: M.fmtDate, onHover: showHover });
    renderTimeline();
    renderCategories();
    renderSave();
    save();
  }

  function renderTiles() {
    const s = summary;
    const tiles = [
      ["Dec 31 balance", M.naira(s.decemberEndBalance), s.decemberEndBalance < 0],
      ["Lowest point", `${M.naira(s.lowest.balance)} · ${M.fmtDate(s.lowest.date)}`, s.lowest.balance < 0],
      ["Broke on", s.brokeDate ? M.fmtDate(s.brokeDate) : "Never 💪", !!s.brokeDate],
      ["January runway", `${s.januaryRunway}/${s.januaryDays} days`, s.januaryRunway < s.januaryDays],
    ];
    $("tiles").innerHTML = tiles.map(([k, v, bad]) =>
      `<div class="tile"><span>${k}</span><b style="color:${bad ? "var(--red)" : "var(--text)"}">${v}</b></div>`).join("");
    const v = $("verdict");
    v.className = "verdict v" + s.verdict.level;
    v.textContent = s.verdict.text;
  }

  function showHover(d) {
    const el = $("hoverline");
    if (!d) { el.textContent = ""; return; }
    const bits = [`<b>${M.fmtDate(d.date)}</b>: ${M.naira(d.balance)}`];
    if (d.isPayday) bits.push(`💰 payday +${M.naira(d.income)}`);
    d.events.forEach((e) => bits.push(`${esc(e.name)} −${M.naira(e.cost)}`));
    el.innerHTML = bits.join(" · ");
  }

  function renderTimeline() {
    const sorted = [...state.events].sort((a, b) => a.date.localeCompare(b.date) || b.cost - a.cost);
    $("evCount").textContent = `${state.events.filter((e) => e.enabled).length} of ${state.events.length} on`;
    if (!sorted.length) { $("timeline").innerHTML = `<p class="empty">No plans yet. Add one, or tap a quick add.</p>`; return; }
    const groups = {};
    sorted.forEach((e) => (groups[e.date] = groups[e.date] || []).push(e));
    $("timeline").innerHTML = Object.entries(groups).map(([date, evs]) => `
      <div class="day"><div class="d">${M.fmtDate(date)}</div>
        ${evs.map((e) => `
          <div class="ev ${e.enabled ? "" : "off"}">
            <span class="cat" style="background:${(M.CATEGORIES[e.category] || M.CATEGORIES.other).color}"></span>
            <span class="nm">${esc(e.name)}</span>
            <span class="ct">${M.naira(e.cost)}</span>
            <span><input type="checkbox" class="switch" data-toggle="${e.id}" ${e.enabled ? "checked" : ""} title="Include in forecast"><button class="x" data-del="${e.id}" title="Delete">✕</button></span>
          </div>`).join("")}
      </div>`).join("");
  }

  function renderCategories() {
    const parts = Object.entries(summary.byCategory)
      .map(([k, v]) => ({ key: k, value: v, ...(M.CATEGORIES[k] || M.CATEGORIES.other) }))
      .sort((a, b) => b.value - a.value);
    C.donut($("donut"), parts);
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    $("cats").innerHTML = parts.map((p) =>
      `<div><span><i style="background:${p.color}"></i>${p.label}</span><span>${M.naira(p.value)} · ${Math.round((p.value / total) * 100)}%</span></div>`).join("");
  }

  function renderSave() {
    const r = M.saveMe(state);
    const el = $("save");
    if (!r.needed) {
      el.innerHTML = `<h3>Save me 🛟</h3><p>You never go below zero. Nothing to cancel. Enjoy yourself.</p>`;
      return;
    }
    el.innerHTML = `
      <h3>Save me 🛟</h3>
      <p>${r.impossible ? "Even cancelling everything won't save you. Your daily spend is the problem." :
        `Cancel ${r.cancel.length === 1 ? "this" : "these"} and you never go below zero (saves ${M.naira(r.saved)}):`}</p>
      <ul>${r.cancel.map((e) => `<li><span>${esc(e.name)}</span><b>${M.naira(e.cost)}</b></li>`).join("")}</ul>
      ${r.impossible ? "" : `<button class="btn sm" id="applySave">Cancel ${r.cancel.length === 1 ? "it" : "them"}</button>`}`;
    const btn = $("applySave");
    if (btn) btn.onclick = () => {
      const ids = r.cancel.map((e) => e.id);
      state.events.forEach((e) => { if (ids.includes(e.id)) e.enabled = false; });
      render();
    };
  }

  // ---------- inputs ----------
  function initSettings() {
    document.querySelectorAll("[data-k]").forEach((inp) => {
      const k = inp.dataset.k;
      const show = () => (inp.value = k === "payday" ? state.settings[k] : Number(state.settings[k]).toLocaleString("en-NG"));
      show();
      inp.addEventListener("input", () => {
        let v = num(inp.value);
        if (k === "payday") v = Math.min(31, Math.max(1, v || 1));
        state.settings[k] = v;
        render();
      });
      inp.addEventListener("blur", show);
    });
  }

  function initAdd() {
    $("evCat").innerHTML = Object.entries(M.CATEGORIES).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join("");
    $("addForm").onsubmit = (e) => {
      e.preventDefault();
      const cost = num($("evCost").value);
      if (!cost) { $("evCost").focus(); return; }
      addEvent($("evName").value.trim(), $("evDate").value, $("evCat").value, cost);
      $("evName").value = ""; $("evCost").value = "";
    };
    $("chips").innerHTML = PRESETS.map((p, i) => `<button class="chip" data-p="${i}">${p[0]}</button>`).join("");
    $("chips").onclick = (e) => {
      const b = e.target.closest("[data-p]"); if (!b) return;
      const [label, cat, cost, date] = PRESETS[b.dataset.p];
      addEvent(label.replace(/^\S+\s/, ""), date, cat, cost);
    };
  }

  function addEvent(name, date, category, cost) {
    state.events.push({ id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || "Untitled plan", date, category, cost, enabled: true });
    render();
  }

  $("timeline").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { state.events = state.events.filter((x) => x.id !== del.dataset.del); render(); }
  });
  $("timeline").addEventListener("change", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) { const ev = state.events.find((x) => x.id === t.dataset.toggle); ev.enabled = t.checked; render(); }
  });

  // ---------- tools ----------
  $("shareBtn").onclick = () => {
    const card = C.shareCard(days, summary, { naira: M.naira, fmtDate: M.fmtDate, url: location.href });
    card.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "detty-december-forecast.png"; a.click();
      const text = `My Detty December forecast: ${summary.verdict.text}\n\nPlan yours 👉 ${location.href}`;
      setTimeout(() => window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank"), 400);
    });
  };
  $("exportBtn").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
    a.download = "detty-plan.json"; a.click();
  };
  $("importFile").onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data.settings || !Array.isArray(data.events)) throw new Error("bad file");
      state = data; initSettings(); render();
    } catch (err) { alert("That file isn't a Detty plan export."); }
  };
  $("resetBtn").onclick = () => { state = M.defaultState(); initSettings(); render(); };
  window.addEventListener("resize", () => C.balanceChart($("chart"), days, { fmtDate: M.fmtDate, onHover: showHover }));

  initSettings();
  initAdd();
  render();
})();
