const test = require("node:test");
const assert = require("node:assert");
const M = require("../detty/model.js");

const base = () => ({
  settings: { startBalance: 100000, salary: 0, payday: 25, dailySpend: 0, startDate: "2026-12-01", endDate: "2027-01-31" },
  events: [],
});

test("simulates every day from Dec 1 to Jan 31", () => {
  const days = M.simulate(base());
  assert.strictEqual(days.length, 62);
  assert.strictEqual(days[0].date, "2026-12-01");
  assert.strictEqual(days.at(-1).date, "2027-01-31");
});

test("daily spend, events and payday move the balance", () => {
  const s = base();
  s.settings.dailySpend = 1000;
  s.settings.salary = 50000;
  s.events.push({ id: "a", name: "x", date: "2026-12-02", category: "club", cost: 20000, enabled: true });
  const days = M.simulate(s);
  assert.strictEqual(days[0].balance, 99000);
  assert.strictEqual(days[1].balance, 78000);
  const payday = days.find((d) => d.date === "2026-12-25");
  assert.ok(payday.isPayday);
  assert.strictEqual(payday.balance, 100000 - 25 * 1000 - 20000 + 50000);
});

test("disabled events are ignored", () => {
  const s = base();
  s.events.push({ id: "a", date: "2026-12-05", category: "club", cost: 500000, enabled: false });
  assert.strictEqual(M.summarize(s).brokeDate, null);
});

test("finds the broke date and January runway", () => {
  const s = base();
  s.events.push({ id: "a", date: "2027-01-10", category: "club", cost: 150000, enabled: true });
  const sum = M.summarize(s);
  assert.strictEqual(sum.brokeDate, "2027-01-10");
  assert.strictEqual(sum.januaryRunway, 9);
});

test("saveMe picks the cheapest single event that fixes things", () => {
  const s = base();
  s.events.push(
    { id: "big", date: "2026-12-10", category: "club", cost: 90000, enabled: true },
    { id: "small", date: "2026-12-11", category: "food", cost: 20000, enabled: true },
  );
  const r = M.saveMe(s);
  assert.strictEqual(r.needed, true);
  assert.deepStrictEqual(r.cancel.map((e) => e.id), ["small"]);
});

test("saveMe falls back to cancelling several events", () => {
  const s = base();
  s.events.push(
    { id: "a", date: "2026-12-10", category: "club", cost: 60000, enabled: true },
    { id: "b", date: "2026-12-11", category: "food", cost: 60000, enabled: true },
    { id: "c", date: "2026-12-12", category: "food", cost: 60000, enabled: true },
  );
  const r = M.saveMe(s);
  assert.strictEqual(r.cancel.length, 2);
});

test("saveMe says no action when you're fine", () => {
  assert.strictEqual(M.saveMe(base()).needed, false);
});

test("default demo state goes broke in January before payday", () => {
  const sum = M.summarize(M.defaultState());
  console.log("   demo:", sum.brokeDate, sum.verdict.text, M.naira(sum.decemberEndBalance));
  assert.ok(sum.brokeDate && sum.brokeDate.startsWith("2027-01"));
});
