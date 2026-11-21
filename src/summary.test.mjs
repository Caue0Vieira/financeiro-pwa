import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSummary, fallbackText, monthLabel, summaryFrom, summaryPrompt, usableComment } from "./summary.ts";

const october = {
  month: "2026-10",
  income: 625000,
  expenses: 410000,
  categories: [
    { category: "Alimentação", amount: 90000 }, { category: "alimentação ", amount: 10000 }, { category: "Lazer", amount: 60000 },
    { category: "Moradia", amount: 188000 }, { category: "Saúde", amount: 30000 }, { category: "Viagem", amount: 32000 },
  ],
  previous: [{ category: "Alimentação", amount: 70000 }, { category: "Lazer", amount: 20000 }, { category: "Moradia", amount: 188000 }, { category: "Saúde", amount: 40000 }],
  goal: 200000,
  largest: { description: "Aluguel", amount: 188000, date: "2026-10-07" },
};

test("numbers come from the totals: balance, top growth, goal and largest expense", () => {
  const summary = buildSummary(october);
  assert.equal(summary.balance, 215000);
  // Same category written differently is one; new categories count from zero; drops are left out.
  assert.deepEqual(summary.growth, [
    { category: "Lazer", amount: 60000, previous: 20000 },
    { category: "Viagem", amount: 32000, previous: 0 },
    { category: "Alimentação", amount: 100000, previous: 70000 },
  ]);
  assert.equal(summary.goalMet, true);
  assert.deepEqual(summary.largest, { description: "Aluguel", amount: 188000, date: "2026-10-07" });
  assert.equal(buildSummary({ ...october, goal: 300000 }).goalMet, false);
  assert.equal(buildSummary({ ...october, goal: 0 }).goalMet, null);
  assert.equal(buildSummary({ ...october, largest: null, categories: [], previous: [] }).growth.length, 0);
  // Values from SQL can arrive as strings.
  assert.equal(buildSummary({ ...october, income: "1000", expenses: "250" }).balance, 750);
});

test("the AI comment is used only without numbers", () => {
  assert.equal(usableComment("  Outubro foi um mês equilibrado.\nVale olhar o lazer de perto. "), "Outubro foi um mês equilibrado. Vale olhar o lazer de perto.");
  assert.equal(usableComment("Você gastou R$ 600 com lazer."), null);
  assert.equal(usableComment("Curto"), null);
  assert.equal(usableComment(undefined), null);
  const text = fallbackText(buildSummary(october), "2026-10");
  assert.match(text, /^Você fechou outubro/);
  assert.match(text, /Lazer foi a categoria que mais cresceu/);
  assert.doesNotMatch(text, /\d/);
});

test("prompt carries the computed numbers and forbids repeating them", () => {
  const [system, user] = summaryPrompt(buildSummary(october), "2026-10");
  assert.match(system.content, /NÃO escreva nenhum número/);
  assert.match(user.content, /Saldo: R\$ 2150,00/);
  assert.match(user.content, /Lazer \(de R\$ 200,00 para R\$ 600,00\)/);
  assert.equal(monthLabel("2026-10"), "outubro de 2026");
});

test("stored rows become the app's summary", () => {
  const numbers = buildSummary(october);
  assert.deepEqual(summaryFrom({ month: "2026-10-01", numbers, text: "Ok.", dismissed_at: null }), { ...numbers, month: "2026-10", text: "Ok.", dismissed: false });
});
