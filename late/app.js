/* Why I'm Late: UI. Scoring lives in engine.js. */
(function () {
  "use strict";
  const E = window.LateEngine;
  const $ = (id) => document.getElementById(id);
  const KEY = "late-v2";

  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const st = {
    from: saved.from || "Lekki", to: saved.to || "Yaba", mode: saved.mode || "uber",
    minutesLate: saved.minutesLate || 30, hour: new Date().getHours() < 6 ? 8 : Math.min(new Date().getHours(), 22),
    rain: false, history: saved.history || [],
  };
  let current = null, shown = [];

  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ from: st.from, to: st.to, mode: st.mode, minutesLate: st.minutesLate, history: st.history })); } catch (e) {} };
  const color = (s) => (s >= 75 ? "var(--green)" : s >= 50 ? "var(--gold)" : "var(--red)");
  const input = () => ({ ...st, now: Date.now() });

  // ---------- controls ----------
  const areas = Object.keys(E.AREAS);
  const opts = (sel) => areas.map((a) => `<option ${a === sel ? "selected" : ""}>${a}</option>`).join("");
  $("from").innerHTML = opts(st.from);
  $("to").innerHTML = opts(st.to);
  $("modes").innerHTML = Object.entries(E.MODES).map(([k, v]) => `<button class="mode ${k === st.mode ? "on" : ""}" data-m="${k}">${v}</button>`).join("");
  $("hour").innerHTML = Array.from({ length: 17 }, (_, i) => i + 6).map((h) =>
    `<option value="${h}" ${h === st.hour ? "selected" : ""}>${((h + 11) % 12) + 1}:00 ${h < 12 ? "am" : "pm"}</option>`).join("");
  $("mins").value = st.minutesLate;
  const minsLabel = () => ($("minsVal").textContent = st.minutesLate >= 60 ? `${Math.floor(st.minutesLate / 60)}h ${st.minutesLate % 60 ? (st.minutesLate % 60) + "m" : ""}` : st.minutesLate + " min");
  minsLabel();

  $("from").onchange = (e) => { st.from = e.target.value; refresh(); };
  $("to").onchange = (e) => { st.to = e.target.value; refresh(); };
  $("hour").onchange = (e) => { st.hour = Number(e.target.value); refresh(); };
  $("rain").onchange = (e) => { st.rain = e.target.checked; refresh(); };
  $("mins").oninput = (e) => { st.minutesLate = Number(e.target.value); minsLabel(); refresh(); };
  $("modes").onclick = (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    st.mode = b.dataset.m;
    document.querySelectorAll(".mode").forEach((m) => m.classList.toggle("on", m === b));
    refresh();
  };

  // ---------- output ----------
  function show(ex) {
    current = ex;
    $("result").classList.remove("hidden");
    const el = $("excuse"); el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
    el.textContent = ex.text;
    $("bar").style.width = ex.score + "%";
    $("bar").style.background = color(ex.score);
    $("score").textContent = ex.score + "%";
    $("score").style.color = color(ex.score);
    $("reasons").textContent = ex.reasons.length ? "⚠️ " + ex.reasons.join(" · ") : "";
    $("reaction").textContent = ex.reaction;
    $("evidence").textContent = "📸 If they ask for proof: " + ex.evidence;
  }

  function generate(fresh) {
    if (fresh) shown = [];
    let ex = E.generate(input(), { exclude: shown });
    if (!ex) { shown = []; ex = E.generate(input()); }
    shown.push(ex.id);
    show(ex);
    renderAlts();
  }

  function renderAlts() {
    const ranked = E.rank(input()).slice(0, 6);
    $("altCard").classList.remove("hidden");
    $("alts").innerHTML = ranked.map((e) => `<li data-id="${e.id}"><span>${e.text}</span><b style="color:${color(e.score)}">${e.score}%</b></li>`).join("");
  }
  $("alts").onclick = (e) => {
    const li = e.target.closest("[data-id]"); if (!li) return;
    const ex = E.rank(input()).find((x) => x.id === li.dataset.id);
    const full = E.generate(input(), { seed: 1, exclude: E.EXCUSES.map((x) => x.id).filter((id) => id !== ex.id) });
    show(full);
    window.scrollTo({ top: $("result").offsetTop - 20, behavior: "smooth" });
  };

  // refresh live if a result is showing (inputs changed)
  function refresh() {
    persist();
    if (!current) return;
    const again = E.rank(input()).find((x) => x.id === current.id);
    if (again) show(E.generate(input(), { seed: 1, exclude: E.EXCUSES.map((x) => x.id).filter((id) => id !== again.id) }));
    else generate(true);
    renderAlts();
  }

  function renderHistory() {
    const week = Date.now() - 7 * 86400000;
    const recent = st.history.filter((h) => h.at >= week).sort((a, b) => b.at - a.at);
    const sus = E.suspicion(recent.length);
    $("susText").textContent = sus.text;
    $("dots").innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<i style="background:${i < recent.length ? (sus.level === "high" ? "var(--red)" : sus.level === "medium" ? "var(--gold)" : "var(--green)") : "#26302a"}"></i>`).join("");
    $("hist").innerHTML = recent.length ? recent.map((h) => {
      const ex = E.EXCUSES.find((x) => x.id === h.id);
      const d = new Date(h.at);
      return `<li><span>${ex ? ex.text.replace(/\{\w+\}/g, "…").slice(0, 60) + (ex.text.length > 60 ? "…" : "") : h.id}</span><span>${d.toLocaleDateString(undefined, { weekday: "short" })}</span></li>`;
    }).join("") : `<li>No excuses used this week. Who are you?</li>`;
  }

  $("go").onclick = () => generate(true);
  $("another").onclick = () => generate(false);
  $("use").onclick = () => {
    if (!current) return;
    st.history.push({ id: current.id, at: Date.now() });
    st.history = st.history.slice(-50);
    persist(); renderHistory(); refresh();
    $("use").textContent = "Logged ✓";
    setTimeout(() => ($("use").textContent = "Use this one"), 1200);
  };
  $("clear").onclick = () => { st.history = []; persist(); renderHistory(); refresh(); };

  // ---------- share card ----------
  $("share").onclick = () => {
    if (!current) return;
    const c = document.createElement("canvas"); c.width = 1200; c.height = 675;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(600, -100, 50, 600, 300, 900); g.addColorStop(0, "#12361f"); g.addColorStop(1, "#0c0f0d");
    x.fillStyle = g; x.fillRect(0, 0, 1200, 675);
    x.fillStyle = "#1fc46b"; x.font = "700 26px -apple-system, Inter, sans-serif"; x.fillText(`WHY I'M LATE · ${st.from.toUpperCase()} → ${st.to.toUpperCase()}`, 64, 90);
    x.fillStyle = "#eef3ef"; x.font = "800 52px -apple-system, Inter, sans-serif";
    let y = 180, line = "";
    for (const w of ("“" + current.text + "”").split(" ")) {
      const t = line ? line + " " + w : w;
      if (x.measureText(t).width > 1070) { x.fillText(line, 64, y); y += 64; line = w; } else line = t;
    }
    x.fillText(line, 64, y);
    x.fillStyle = "#151a17"; x.fillRect(64, 500, 1072, 16);
    x.fillStyle = current.score >= 75 ? "#1fc46b" : current.score >= 50 ? "#f2b43a" : "#ff5d5d"; x.fillRect(64, 500, 1072 * current.score / 100, 16);
    x.fillStyle = "#8fa197"; x.font = "26px -apple-system, Inter, sans-serif";
    x.fillText(`Believability ${current.score}%  ·  Manager: ${current.reaction}`, 64, 565);
    x.font = "20px -apple-system, Inter, sans-serif"; x.fillText(location.href.replace(/^https?:\/\//, ""), 64, 630);
    c.toBlob((b) => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "why-im-late.png"; a.click();
      setTimeout(() => window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(
        `My excuse engine says: "${current.text}" (${current.score}% believable) 😭\n\nGet yours 👉 ${location.href}`), "_blank"), 400);
    });
  };

  renderHistory();
})();
