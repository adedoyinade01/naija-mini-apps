/*
 * Why I'm Late: the excuse engine.
 * Scores every excuse against your actual situation (route, transport, time, rain, how late you are,
 * and how often you've used it this week) and returns the most believable ones.
 * Pure functions, no DOM, so it's unit-tested in Node.
 */
(function (root) {
  "use strict";

  const AREAS = {
    "Lekki": { side: "island", road: "Lekki-Epe Expressway", toll: true },
    "Ajah": { side: "island", road: "Lekki-Epe Expressway", toll: true },
    "Victoria Island": { side: "island", road: "Ozumba Mbadiwe" },
    "Ikoyi": { side: "island", road: "Awolowo Road" },
    "Lagos Island": { side: "island", road: "Marina" },
    "Oniru": { side: "island", road: "Admiralty Way" },
    "Yaba": { side: "mainland", road: "Herbert Macaulay Way" },
    "Surulere": { side: "mainland", road: "Eko Bridge" },
    "Ikeja": { side: "mainland", road: "Obafemi Awolowo Way" },
    "Ikorodu": { side: "mainland", road: "Ikorodu Road", far: true },
    "Ojota": { side: "mainland", road: "Ikorodu Road" },
    "Gbagada": { side: "mainland", road: "Gbagada Expressway" },
    "Maryland": { side: "mainland", road: "Ikorodu Road" },
    "Festac": { side: "mainland", road: "Apapa-Oshodi Expressway", far: true },
    "Oshodi": { side: "mainland", road: "Apapa-Oshodi Expressway" },
    "Magodo": { side: "mainland", road: "CMD Road" },
    "Berger": { side: "mainland", road: "Lagos-Ibadan Expressway", far: true },
    "Ketu": { side: "mainland", road: "Ikorodu Road" },
    "Agege": { side: "mainland", road: "Agege Motor Road" },
    "Apapa": { side: "mainland", road: "Apapa-Oshodi Expressway" },
  };

  const MODES = { uber: "Uber/Bolt", bus: "Danfo/BRT", car: "My own car", okada: "Okada/Keke", walk: "Walked" };

  /*
   * Each excuse: text ({from} {to} {road} {bridge}), base believability, typical delay [min,max] minutes,
   * and conditions. `evidence` is what to screenshot if your manager asks.
   */
  const EXCUSES = [
    { id: "bridge", text: "Third Mainland Bridge was moving like it had a meeting I wasn't invited to.", base: 0.88, delay: [20, 120], needs: { crossing: true }, evidence: "Google Maps screenshot of the red bridge" },
    { id: "road", text: "{road} was completely locked. I moved 2km in one hour.", base: 0.82, delay: [15, 90], evidence: "Google Maps traffic layer screenshot" },
    { id: "flood", text: "It rained for 15 minutes and {road} became a swimming pool.", base: 0.95, delay: [30, 180], needs: { rain: true }, evidence: "Video of the flooded road (everyone has one)" },
    { id: "rain-hold", text: "The rain was too heavy, no driver wanted to move until it eased off.", base: 0.85, delay: [20, 90], needs: { rain: true }, evidence: "Weather app screenshot" },
    { id: "trailer", text: "A trailer broke down on {road} and blocked two lanes.", base: 0.78, delay: [30, 150], needs: { roadType: "expressway" }, evidence: "Twitter/X traffic update about the trailer" },
    { id: "uber-cancel", text: "Two Uber drivers accepted, drove the opposite way, then cancelled. The third one asked me to 'come to the junction'.", base: 0.86, delay: [10, 45], needs: { mode: "uber" }, evidence: "Ride app cancellation screenshots" },
    { id: "surge", text: "Uber surge was 3x so I waited for it to drop. It went up instead.", base: 0.6, delay: [10, 35], needs: { mode: "uber" }, evidence: "Fare estimate screenshot" },
    { id: "brt", text: "BRT came full, left full and came back full. Three times.", base: 0.84, delay: [10, 50], needs: { mode: "bus" }, evidence: "None needed. Everyone knows." },
    { id: "danfo", text: "Danfo conductor collected everyone's money then the bus 'developed fault' at {road}.", base: 0.78, delay: [15, 60], needs: { mode: "bus" }, evidence: "Ask your colleagues who take danfo" },
    { id: "fuel", text: "My fuel light came on and the only open station had a queue to the next street.", base: 0.72, delay: [20, 90], needs: { mode: "car" }, evidence: "Photo of the queue" },
    { id: "flat", text: "Flat tyre on {road}. Vulcanizer said 'five minutes'. It was not five minutes.", base: 0.74, delay: [25, 75], needs: { mode: "car" }, evidence: "Photo of the tyre" },
    { id: "taskforce", text: "Task force stopped the okada on {road} and I had to find another way.", base: 0.7, delay: [15, 60], needs: { mode: "okada" }, evidence: "Hopefully none" },
    { id: "convoy", text: "There was a VIP convoy and they shut down the road for 30 minutes. I was not the VIP.", base: 0.7, delay: [15, 45], bonus: { island: 1.15 }, evidence: "None. Convoys don't post schedules." },
    { id: "toll", text: "Lekki toll gate was moving at the speed of my salary.", base: 0.78, delay: [10, 40], needs: { toll: true }, evidence: "Google Maps screenshot near the toll" },
    { id: "accident", text: "There was an accident on {road}, everyone slowed down to look.", base: 0.76, delay: [20, 90], evidence: "Traffic update on X" },
    { id: "far", text: "Coming from {from} to {to} is a pilgrimage. I left at 5:30am. I'm still processing it.", base: 0.68, delay: [10, 60], needs: { far: true }, evidence: "Your address. It speaks for itself." },
    { id: "nepa", text: "No light all night, phone died, alarm didn't ring.", base: 0.5, delay: [15, 75], needs: { time: "morning" }, evidence: "A dead phone is its own evidence" },
    { id: "landlord", text: "Landlord came to talk about rent at 7am. I couldn't just walk out of that conversation.", base: 0.42, delay: [10, 40], needs: { time: "morning" }, evidence: "Better not to have any" },
    { id: "mama", text: "My mum called to ask if I've eaten. That call lasted 25 minutes.", base: 0.35, delay: [5, 30], evidence: "Call log, if you're brave" },
    { id: "walk", text: "I walked because the traffic wasn't moving. My legs did their best.", base: 0.55, delay: [10, 40], needs: { mode: "walk" }, evidence: "Your step count" },
    { id: "network", text: "My bank app wouldn't load and I couldn't pay for the ride.", base: 0.45, delay: [5, 25], evidence: "Bank app error screenshot" },
  ];

  const EXPRESSWAYS = ["Lekki-Epe Expressway", "Ikorodu Road", "Apapa-Oshodi Expressway", "Lagos-Ibadan Expressway", "Gbagada Expressway", "Eko Bridge"];

  /** Small seeded RNG (mulberry32) so tests are repeatable. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function context(input) {
    const from = AREAS[input.from], to = AREAS[input.to];
    if (!from || !to) throw new Error("unknown area");
    const hour = input.hour;
    return {
      ...input,
      fromArea: from,
      toArea: to,
      crossing: from.side !== to.side,
      island: from.side === "island" || to.side === "island",
      toll: !!(from.toll || to.toll),
      far: !!(from.far || to.far) || from.side !== to.side,
      road: from.road,
      time: hour < 11 ? "morning" : hour < 16 ? "afternoon" : "evening",
    };
  }

  function lateFit(minutes, [lo, hi]) {
    if (minutes >= lo && minutes <= hi) return 1;
    const dist = minutes < lo ? lo - minutes : minutes - hi;
    return Math.exp(-dist / 25);
  }

  /** Count recent uses (last 7 days) per excuse id from history [{id, at}]. */
  function recentUses(history, now) {
    const week = now - 7 * 86400000;
    const counts = {};
    let total = 0;
    for (const h of history || []) if (h.at >= week) { counts[h.id] = (counts[h.id] || 0) + 1; total++; }
    return { counts, total };
  }

  function suspicion(total) {
    if (total >= 4) return { level: "high", text: "Your manager has started a spreadsheet. 📋", factor: 0.75 };
    if (total >= 2) return { level: "medium", text: "Your manager is noticing a pattern. 👀", factor: 0.9 };
    return { level: "low", text: "Clean record this week. 😇", factor: 1 };
  }

  function applicable(ex, c) {
    const n = ex.needs || {};
    if (n.crossing && !c.crossing) return false;
    if (n.rain && !c.rain) return false;
    if (n.mode && n.mode !== c.mode) return false;
    if (n.toll && !c.toll) return false;
    if (n.far && !c.far) return false;
    if (n.time && n.time !== c.time) return false;
    if (n.roadType === "expressway" && !EXPRESSWAYS.includes(c.road)) return false;
    return true;
  }

  function fill(text, c) {
    return text.replace("{road}", c.road).replace("{from}", c.from).replace("{to}", c.to);
  }

  /**
   * Score every applicable excuse. Returns them sorted, most believable first.
   * input: {from, to, mode, minutesLate, hour, rain, history, now}
   */
  function rank(input) {
    const c = context(input);
    const now = input.now || Date.now();
    const { counts, total } = recentUses(input.history, now);
    const sus = suspicion(total);
    const rushHour = (c.hour >= 6 && c.hour <= 10) || (c.hour >= 16 && c.hour <= 20);

    return EXCUSES.filter((ex) => applicable(ex, c)).map((ex) => {
      let score = ex.base;
      const reasons = [];
      const fit = lateFit(c.minutesLate, ex.delay);
      score *= fit;
      if (fit < 0.6) reasons.push(c.minutesLate > ex.delay[1] ? "too late for this excuse" : "too early for such a big excuse");
      if (ex.bonus && ex.bonus.island && c.island) { score *= ex.bonus.island; reasons.push("convoys love the island"); }
      if (["road", "bridge", "accident", "trailer"].includes(ex.id)) score *= rushHour ? 1.05 : 0.8;
      const used = counts[ex.id] || 0;
      if (used) { score *= Math.pow(0.6, used); reasons.push(`used ${used}× this week`); }
      score *= sus.factor;
      score = Math.max(0.03, Math.min(0.98, score));
      return { id: ex.id, text: fill(ex.text, c), score: Math.round(score * 100), evidence: ex.evidence, reasons };
    }).sort((a, b) => b.score - a.score);
  }

  /** Pick one of the top 3, weighted by score, skipping ones already shown this round. */
  function generate(input, { seed, exclude = [] } = {}) {
    const r = rng(seed == null ? Date.now() : seed);
    const ranked = rank(input).filter((e) => !exclude.includes(e.id));
    if (!ranked.length) return null;
    const top = ranked.slice(0, 3);
    const total = top.reduce((s, e) => s + e.score, 0);
    let x = r() * total;
    for (const e of top) { x -= e.score; if (x <= 0) return withReaction(e, input); }
    return withReaction(top[0], input);
  }

  function withReaction(e, input) {
    const s = e.score;
    const reaction =
      s >= 85 ? "“Lagos sha. No wahala, settle in.” ✅" :
      s >= 65 ? "“Hmm. Okay o.” 🙂" :
      s >= 45 ? "“Send me the screenshot.” 🤨" :
                "“Come and see me in my office.” 💀";
    const sus = suspicion(recentUses(input.history, input.now || Date.now()).total);
    return { ...e, reaction, suspicion: sus };
  }

  const api = { AREAS, MODES, EXCUSES, rank, generate, suspicion, lateFit, context };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LateEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
