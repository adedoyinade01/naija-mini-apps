/*
 * Detty December Planner: the money model.
 * Pure functions only (no DOM), so they can be unit-tested in Node.
 * Dates are "YYYY-MM-DD" strings, handled in UTC to avoid timezone bugs.
 */
(function (root) {
  "use strict";

  const DAY_MS = 86400000;

  const toUTC = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);
  const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
  const dayOfMonth = (iso) => Number(iso.slice(8, 10));

  const CATEGORIES = {
    concert: { label: "Concerts", color: "#1fc46b" },
    club: { label: "Club & lounge", color: "#8b5cf6" },
    owambe: { label: "Owambe & aso ebi", color: "#f2b43a" },
    beach: { label: "Beach & outings", color: "#38bdf8" },
    food: { label: "Food & brunch", color: "#fb7185" },
    transport: { label: "Transport", color: "#f97316" },
    fashion: { label: "Fits", color: "#e879f9" },
    family: { label: "Family & gifts", color: "#a3e635" },
    other: { label: "Other", color: "#94a3b8" },
  };

  function defaultState() {
    return {
      settings: {
        startBalance: 250000,
        salary: 350000,
        payday: 24,
        dailySpend: 4000,
        startDate: "2026-12-01",
        endDate: "2027-01-31",
      },
      events: [
        { id: "e1", name: "Concert at Eko Hotel", date: "2026-12-20", category: "concert", cost: 60000, enabled: true },
        { id: "e2", name: "Club night with the guys", date: "2026-12-13", category: "club", cost: 50000, enabled: true },
        { id: "e3", name: "Cousin's wedding (aso ebi)", date: "2026-12-27", category: "owambe", cost: 45000, enabled: true },
        { id: "e4", name: "Beach day", date: "2026-12-26", category: "beach", cost: 30000, enabled: true },
        { id: "e5", name: "Christmas gifts for family", date: "2026-12-24", category: "family", cost: 70000, enabled: true },
        { id: "e6", name: "New fit for the concert", date: "2026-12-18", category: "fashion", cost: 40000, enabled: true },
        { id: "e7", name: "Owambe Uber surge", date: "2026-12-27", category: "transport", cost: 15000, enabled: true },
        { id: "e8", name: "New year's eve party", date: "2026-12-31", category: "club", cost: 80000, enabled: true },
      ],
    };
  }

  /** Walk day by day from startDate to endDate and track the balance. */
  function simulate(state, overrideEvents) {
    const s = state.settings;
    const events = (overrideEvents || state.events).filter((e) => e.enabled);
    const byDate = {};
    for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);

    const total = daysBetween(s.startDate, s.endDate);
    const days = [];
    let balance = Number(s.startBalance) || 0;

    for (let i = 0; i <= total; i++) {
      const date = addDays(s.startDate, i);
      const todays = byDate[date] || [];
      const isPayday = dayOfMonth(date) === Number(s.payday);
      const eventSpend = todays.reduce((sum, e) => sum + Number(e.cost || 0), 0);
      const income = isPayday ? Number(s.salary) || 0 : 0;
      balance = balance + income - (Number(s.dailySpend) || 0) - eventSpend;
      days.push({ date, balance, income, eventSpend, events: todays, isPayday });
    }
    return days;
  }

  function summarize(state, days) {
    days = days || simulate(state);
    const enabled = state.events.filter((e) => e.enabled);

    let lowest = days[0];
    for (const d of days) if (d.balance < lowest.balance) lowest = d;
    const broke = days.find((d) => d.balance < 0) || null;

    const byCategory = {};
    for (const e of enabled) byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.cost || 0);

    const eventTotal = enabled.reduce((s, e) => s + Number(e.cost || 0), 0);
    const december = days.filter((d) => d.date.slice(5, 7) === "12");
    const decEnd = december.length ? december[december.length - 1].balance : days[0].balance;

    // January runway: how many days into January you stay above zero
    const jan = days.filter((d) => d.date.slice(5, 7) === "01");
    const firstNegJan = jan.findIndex((d) => d.balance < 0);
    const januaryRunway = firstNegJan === -1 ? jan.length : firstNegJan;

    return {
      lowest: { date: lowest.date, balance: lowest.balance },
      brokeDate: broke ? broke.date : null,
      endBalance: days[days.length - 1].balance,
      decemberEndBalance: decEnd,
      eventTotal,
      byCategory,
      januaryRunway,
      januaryDays: jan.length,
      verdict: verdict({ broke, januaryRunway, janDays: jan.length, lowest: lowest.balance, start: Number(state.settings.startBalance) }),
    };
  }

  function verdict({ broke, januaryRunway, janDays, lowest, start }) {
    if (!broke && lowest > start * 0.3) return { level: 4, text: "Financially disciplined. January is scared of you. 👑" };
    if (!broke) return { level: 3, text: "You'll survive, but you'll feel it. Enjoy responsibly. 😌" };
    if (broke.date.slice(5, 7) === "01" && januaryRunway >= 10)
      return { level: 2, text: `Garri arc starts ${fmtDate(broke.date)}. Mentally prepare. 🥣` };
    if (broke.date.slice(5, 7) === "01") return { level: 1, text: "January is going to be a horror movie and you're the main character. 💀" };
    return { level: 0, text: "You're broke before Christmas. Abeg sit down. 😭" };
  }

  /**
   * "Save me": the cheapest set of events to cancel so you never go below zero.
   * 1) Try every single event, pick the cheapest one that fixes it.
   * 2) Otherwise, greedily drop the most expensive events until it's fixed.
   */
  function saveMe(state) {
    const base = summarize(state);
    if (!base.brokeDate) return { needed: false, cancel: [] };

    const enabled = state.events.filter((e) => e.enabled);
    const without = (ids) => state.events.map((e) => (ids.includes(e.id) ? { ...e, enabled: false } : e));
    const fixes = (ids) => !simulate(state, without(ids)).some((d) => d.balance < 0);

    const singles = enabled
      .filter((e) => fixes([e.id]))
      .sort((a, b) => a.cost - b.cost);
    if (singles.length) return { needed: true, cancel: [singles[0]], saved: singles[0].cost };

    const sorted = [...enabled].sort((a, b) => b.cost - a.cost);
    const ids = [];
    for (const e of sorted) {
      ids.push(e.id);
      if (fixes(ids)) {
        const cancel = sorted.filter((x) => ids.includes(x.id));
        return { needed: true, cancel, saved: cancel.reduce((s, x) => s + x.cost, 0) };
      }
    }
    return { needed: true, cancel: sorted, impossible: true, saved: sorted.reduce((s, x) => s + x.cost, 0) };
  }

  const naira = (n) => (n < 0 ? "−" : "") + "₦" + Math.round(Math.abs(n)).toLocaleString("en-NG");
  function fmtDate(iso) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${dayOfMonth(iso)} ${months[Number(iso.slice(5, 7)) - 1]}`;
  }

  const api = { CATEGORIES, defaultState, simulate, summarize, saveMe, addDays, daysBetween, naira, fmtDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DettyModel = api;
})(typeof window !== "undefined" ? window : globalThis);
