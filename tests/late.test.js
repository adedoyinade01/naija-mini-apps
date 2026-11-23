const test = require("node:test");
const assert = require("node:assert");
const E = require("../late/engine.js");

const base = { from: "Lekki", to: "Yaba", mode: "uber", minutesLate: 40, hour: 8, rain: false, history: [], now: 1_800_000_000_000 };

test("bridge excuse only when you cross between island and mainland", () => {
  assert.ok(E.rank(base).some((e) => e.id === "bridge"));
  assert.ok(!E.rank({ ...base, from: "Ikeja", to: "Yaba" }).some((e) => e.id === "bridge"));
});

test("rain unlocks flood excuses and they top the list", () => {
  assert.ok(!E.rank(base).some((e) => e.id === "flood"));
  assert.strictEqual(E.rank({ ...base, rain: true, minutesLate: 70 })[0].id, "flood");
});

test("transport mode filters excuses", () => {
  const ids = E.rank({ ...base, mode: "bus" }).map((e) => e.id);
  assert.ok(ids.includes("brt") && !ids.includes("uber-cancel") && !ids.includes("fuel"));
});

test("being 3 hours late makes small excuses unbelievable", () => {
  const mama = (m) => E.rank({ ...base, minutesLate: m }).find((e) => e.id === "mama").score;
  assert.ok(mama(180) < mama(15) / 5);
});

test("re-using an excuse this week lowers its score", () => {
  const fresh = E.rank(base).find((e) => e.id === "uber-cancel").score;
  const history = [{ id: "uber-cancel", at: base.now - 86400000 }];
  const used = E.rank({ ...base, history }).find((e) => e.id === "uber-cancel");
  assert.ok(used.score < fresh);
  assert.ok(used.reasons.some((r) => r.includes("used 1×")));
});

test("old history (over a week) is forgiven", () => {
  const history = [{ id: "uber-cancel", at: base.now - 8 * 86400000 }];
  assert.strictEqual(E.rank({ ...base, history }).find((e) => e.id === "uber-cancel").reasons.length, 0);
});

test("suspicion rises with excuses this week", () => {
  assert.strictEqual(E.suspicion(0).level, "low");
  assert.strictEqual(E.suspicion(3).level, "medium");
  assert.strictEqual(E.suspicion(5).level, "high");
});

test("generate is deterministic with a seed and respects exclude", () => {
  const a = E.generate(base, { seed: 7 }), b = E.generate(base, { seed: 7 });
  assert.deepStrictEqual(a, b);
  const c = E.generate(base, { seed: 7, exclude: [a.id] });
  assert.notStrictEqual(c.id, a.id);
  assert.ok(a.reaction && a.evidence);
});

test("templates get filled with your route", () => {
  const t = E.rank({ ...base, from: "Ikorodu", to: "Ikeja", mode: "car" }).map((e) => e.text).join(" ");
  assert.ok(t.includes("Ikorodu Road") && !t.includes("{"));
});
