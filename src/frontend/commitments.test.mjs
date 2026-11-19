import assert from "node:assert/strict";
import { test } from "node:test";
import { installmentPlans, monthBreakdown, monthlyTotal, oneOffEntries, recurringGroups } from "./commitments.ts";

const entry = (id, amount, rest = {}) => ({
  id, date: "2026-11-10", description: id, amount, kind: amount > 0 ? "income" : "expense",
  category: "Outros", status: "planned", source: "manual", ...rest,
});
const rule = (id, amount, category, rest = {}) => ({
  id, description: id, amount, kind: amount > 0 ? "income" : "expense", category, startMonth: "2026-01", day: 10, ...rest,
});

test("recurring rules split into fixed bills, subscriptions and income", () => {
  const recurrences = [
    rule("aluguel", -180000, "Moradia", { day: 5 }),
    rule("netflix", -4490, " assinaturas "),
    rule("salario", 600000, "Salário"),
    rule("academia", -9900, "Saúde", { endMonth: "2026-10" }),
    rule("curso", -20000, "Educação", { startMonth: "2027-01" }),
  ];
  const upcoming = [entry("previsto", -4490, { recurrenceId: "netflix", category: "Assinaturas" })];
  const groups = recurringGroups({ recurrences, upcoming }, "2026-11");
  assert.deepEqual(groups.fixed.map(({ rule }) => rule.id), ["aluguel", "curso"]);
  assert.deepEqual(groups.subscriptions.map(({ rule }) => rule.id), ["netflix"]);
  assert.deepEqual(groups.income.map(({ rule }) => rule.id), ["salario"]);
  assert.equal(groups.subscriptions[0].pending?.id, "previsto");
  assert.equal(groups.fixed[0].pending, undefined);
  // A rule that only starts later is listed but does not count in this month's cost.
  assert.equal(groups.fixed[1].started, false);
  assert.equal(monthlyTotal(groups.fixed), 180000);
});

test("installment plans report what is left after this month", () => {
  const plans = installmentPlans([
    entry("fone", -9990, { cardId: "c", invoiceMonth: "2026-11", installmentNumber: 2, installmentCount: 4 }),
    entry("tv", -25000, { cardId: "c", invoiceMonth: "2026-11", installmentNumber: 10, installmentCount: 10 }),
    entry("carne", -5000, { date: "2026-11-03", installmentNumber: 1, installmentCount: 12 }),
  ]);
  assert.deepEqual(plans.map(({ entry }) => entry.id), ["tv", "fone", "carne"]);
  const [tv, fone, carne] = plans;
  assert.deepEqual([tv.left, tv.leftAmount, tv.lastMonth], [0, 0, "2026-11"]);
  assert.deepEqual([fone.left, fone.leftAmount, fone.lastMonth], [2, 19980, "2027-01"]);
  assert.deepEqual([carne.left, carne.lastMonth], [11, "2027-10"]);
});

test("the month breakdown adds up to what is left to pay", () => {
  const upcoming = [
    entry("aluguel", -180000, { recurrenceId: "aluguel" }),
    entry("netflix", -4490, { recurrenceId: "netflix", category: "Assinaturas" }),
    entry("luz", -16340),
    entry("compra", -9990, { cardId: "c" }),
    // Charged on a card: already inside that card's invoice, so not counted again as a subscription.
    entry("spotify", -2190, { recurrenceId: "spotify", category: "Assinaturas", cardId: "c" }),
    entry("bonus", 50000),
  ];
  const invoices = [{ cardId: "c", month: "2026-11", total: 30000, paid: 10000 }, { cardId: "d", month: "2026-11", total: 500, paid: 900 }];
  assert.deepEqual(monthBreakdown({ upcoming, invoices }), { fixed: 180000, subscriptions: 4490, oneOff: 16340, invoices: 20000 });
  assert.deepEqual(oneOffEntries(upcoming).map(({ id }) => id), ["luz", "bonus"]);
});
