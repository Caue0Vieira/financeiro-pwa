import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSummaries } from "./summaries.ts";

const row = (user_id) => ({
  user_id, income: 500000, expenses: 320000, goal: 0, largest: null,
  categories: [{ category: "Mercado", amount: 120000 }], previous: [{ category: "Mercado", amount: 80000 }],
});

function fakeDb(inputs) {
  const writes = [];
  return {
    writes,
    rpc: async (name, args) => ({ data: name === "monthly_summary_inputs" ? inputs(args) : null, error: null }),
    from: (table) => ({ upsert: async (rows, options) => { writes.push({ table, rows, options }); return { error: null }; } }),
  };
}

test("one row per user, numbers by the app, comment by the AI unless it brings numbers", async () => {
  const asked = [];
  const db = fakeDb((args) => {
    asked.push(args);
    return [row("a"), row("b")];
  });
  let call = 0;
  const ai = { run: async () => ({ response: ++call === 1 ? "Mês tranquilo, com mercado um pouco mais pesado." : "Você gastou 1200 no mercado." }) };
  const created = await generateSummaries(db, ai, "2026-10");
  assert.deepEqual(asked, [{ p_month: "2026-10-01", p_users: null }]);
  assert.equal(created.length, 2);
  assert.equal(created[0].numbers.balance, 180000);
  assert.deepEqual(created[0].numbers.growth, [{ category: "Mercado", amount: 120000, previous: 80000 }]);
  assert.equal(created[0].text, "Mês tranquilo, com mercado um pouco mais pesado.");
  assert.doesNotMatch(created[1].text, /\d/);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].table, "monthly_summaries");
  assert.deepEqual(db.writes[0].options, { ignoreDuplicates: true });
});

test("on demand for one user; nothing to write when the month already has a summary", async () => {
  const db = fakeDb(() => []);
  assert.deepEqual(await generateSummaries(db, undefined, "2026-10", "u1"), []);
  assert.equal(db.writes.length, 0);
  const failing = { run: async () => { throw new Error("4006: daily free allocation"); } };
  const [summary] = await generateSummaries(fakeDb(() => [row("a")]), failing, "2026-10", "a");
  assert.match(summary.text, /^Você fechou outubro/);
});
