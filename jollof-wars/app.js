/* Jollof Wars frontend: live results over Server-Sent Events, with polling fallback. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = (new URLSearchParams(location.search).get("api") || window.JOLLOF_API || "").replace(/\/$/, "");

  const COUNTRIES = [["NG", "Nigeria"], ["GH", "Ghana"], ["GB", "United Kingdom"], ["US", "United States"], ["CA", "Canada"],
    ["SN", "Senegal"], ["CM", "Cameroon"], ["SL", "Sierra Leone"], ["LR", "Liberia"], ["GM", "Gambia"], ["ZA", "South Africa"],
    ["KE", "Kenya"], ["IE", "Ireland"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["AE", "UAE"], ["AU", "Australia"]];
  const NAMES = Object.fromEntries(COUNTRIES);
  const flag = (cc) => cc.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

  const LINES = {
    ng: { label: "🇳🇬 Team Nigeria", tag: "#TeamNigeria", lines: [
      "Party jollof with the bottom-pot burn is a national treasure. Ghana is still preheating the pot.",
      "Nigerian jollof doesn't need basmati to feel important. Long grain, long history.",
      "We don't argue about jollof. We serve it at the owambe and let the silence speak.",
      "If your jollof needs shito to taste like something, that's a group project.",
      "Smoky. Peppery. Unbothered. That's not just our jollof, that's our personality."] },
    gh: { label: "🇬🇭 Team Ghana", tag: "#TeamGhana", lines: [
      "Ghana jollof uses fragrant rice because we cook for flavour, not crowd control.",
      "Nigerian party jollof is 40% rice, 60% smoke from the firewood. We noticed.",
      "Shito on the side is called innovation. Look it up.",
      "Our jollof doesn't need a canopy and a live band to taste good.",
      "We let Nigeria talk. Ghana just keeps cooking. Results speak."] },
    peace: { label: "🕊️ Neutral", tag: "#JollofPeace", lines: [
      "Both jollofs are amazing and I will be blocked by both countries for saying it.",
      "Nigerian jollof on Saturday, Ghanaian jollof on Sunday. I am Switzerland.",
      "Senegal invented it and both of you should be quiet. Respectfully. Don't come for me."] },
  };

  // ---------- identity ----------
  function voterId() {
    let id = null;
    try { id = localStorage.getItem("jollof-voter"); } catch (e) {}
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12));
      try { localStorage.setItem("jollof-voter", id); } catch (e) {}
    }
    return id;
  }
  const VOTER = voterId();

  // ---------- state ----------
  let side = null, lineIdx = -1, myVote = null;

  // ---------- results rendering ----------
  function renderResults(r) {
    const p = r.percent, t = r.totals;
    $("pNg").textContent = p.ng + "%";
    $("pGh").textContent = p.gh + "%";
    $("bNg").style.width = p.ng + "%";
    $("bGh").style.width = p.gh + "%";
    $("bPeace").style.width = p.peace + "%";
    $("total").textContent = `${r.total.toLocaleString()} vote${r.total === 1 ? "" : "s"}`;
    $("peace").textContent = `🕊️ ${t.peace.toLocaleString()} coward${t.peace === 1 ? "" : "s"}`;

    const max = Math.max(1, ...r.hourly.map((h) => h.ng + h.gh + h.peace));
    $("hourly").innerHTML = r.hourly.map((h) => {
      const tot = h.ng + h.gh + h.peace;
      return `<div title="${tot} votes" style="height:${Math.max(2, (tot / max) * 100)}%">
        <span class="b-ng" style="height:${tot ? (h.ng / tot) * 100 : 0}%"></span>
        <span class="b-peace" style="height:${tot ? (h.peace / tot) * 100 : 0}%"></span>
        <span class="b-gh" style="height:${tot ? (h.gh / tot) * 100 : 0}%"></span></div>`;
    }).join("");

    $("countries").innerHTML = r.countries.length ? r.countries.map((c) => `
      <tr><td style="width:150px">${flag(c.country)} ${NAMES[c.country] || c.country}</td>
      <td><div class="mini"><span class="b-ng" style="width:${(c.ng / c.total) * 100}%"></span><span class="b-peace" style="width:${(c.peace / c.total) * 100}%"></span><span class="b-gh" style="width:${(c.gh / c.total) * 100}%"></span></div></td>
      <td class="n">${c.total}</td></tr>`).join("")
      : `<tr><td style="color:var(--muted)">No votes yet. Be the first.</td></tr>`;
  }

  function setLive(state, text) {
    $("live").className = "live" + (state === "on" ? " on" : "");
    $("liveText").textContent = text;
  }

  function goOffline(why) {
    setLive("off", "offline");
    $("offline").classList.remove("hidden");
    $("offlineWhy").textContent = why || "";
    document.querySelectorAll(".live-only").forEach((el) => el.classList.add("hidden"));
    $("board").classList.add("hidden");
    $("castRow").classList.add("hidden");
  }

  // ---------- network ----------
  async function api(path, opts) {
    const res = await fetch(API + path, { ...opts, headers: { "Content-Type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || "request failed"), { status: res.status, body });
    return body;
  }

  let pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    setLive("on", "live (polling)");
    const tick = () => api("/api/results").then(renderResults).catch(() => setLive("off", "reconnecting…"));
    tick();
    pollTimer = setInterval(tick, 10000);
  }

  function connect() {
    if (!API) return goOffline("");
    if (!window.EventSource) return startPolling();
    const es = new EventSource(API + "/api/stream");
    let opened = false;
    es.addEventListener("results", (e) => { opened = true; setLive("on", "live"); renderResults(JSON.parse(e.data)); });
    es.onerror = () => {
      es.close();
      if (!opened) {
        api("/api/health").then(startPolling).catch(() => goOffline("The vote server isn't reachable."));
      } else {
        setLive("off", "reconnecting…");
        setTimeout(connect, 3000);
      }
    };
  }

  async function loadMine() {
    if (!API) return;
    try {
      const { vote } = await api("/api/me?voter=" + encodeURIComponent(VOTER));
      if (vote) {
        myVote = vote;
        $("mine").textContent = `you voted ${LINES[vote.side].label}`;
        $("country").value = vote.country;
      }
    } catch (e) { /* ignore */ }
  }

  async function cast() {
    const btn = $("cast");
    btn.disabled = true;
    msg("Counting your vote…");
    try {
      const r = await api("/api/vote", { method: "POST", body: JSON.stringify({ side, country: $("country").value, voter: VOTER }) });
      renderResults(r.results);
      myVote = { side, country: $("country").value };
      $("mine").textContent = `you voted ${LINES[side].label}`;
      msg({ created: "Vote counted. Now go defend it on the timeline. 🫡", changed: "Vote changed. We saw that, traitor. 👀",
        unchanged: "You already voted for this side. Loyal. 🫡" }[r.status], "ok");
    } catch (e) {
      msg(e.status === 429 ? "Easy! Too many votes. Try again in a minute." : "Couldn't reach the vote server. Try again.", "err");
    } finally {
      btn.disabled = false;
    }
  }

  function msg(text, cls) { const m = $("msg"); m.textContent = text; m.className = "msg " + (cls || ""); }

  // ---------- picking + statements ----------
  function pick(s) {
    side = s;
    document.querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
    $("cast").disabled = false;
    $("cast").textContent = myVote && myVote.side !== s ? "Change my vote" : "Cast vote";
    $("statement").classList.remove("hidden");
    $("stLabel").textContent = LINES[s].label;
    reroll();
  }

  function reroll() {
    const list = LINES[side].lines;
    let i; do { i = Math.floor(Math.random() * list.length); } while (i === lineIdx && list.length > 1);
    lineIdx = i;
    const t = $("stText"); t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop");
    t.textContent = "“" + list[i] + "”";
  }

  // ---------- init ----------
  const guess = (navigator.language || "").split("-")[1];
  $("country").innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}">${flag(c)} ${n}</option>`).join("");
  $("country").value = NAMES[guess] ? guess : "NG";
  document.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => pick(b.dataset.s)));
  $("cast").onclick = cast;
  $("reroll").onclick = reroll;
  $("post").onclick = () => window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(
    `${LINES[side].lines[lineIdx]} ${LINES[side].tag} 🍛\n\nVote live 👉 ${location.origin + location.pathname}`), "_blank");

  connect();
  loadMine();
})();
