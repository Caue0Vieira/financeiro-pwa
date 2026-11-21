import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSimulation, financialSummary, simulatePurchase } from "./purchase.ts";

const rule = (id, amount, rest = {}) => ({
  id, description: id, amount, kind: amount > 0 ? "income" : "expense", category: "Moradia", startMonth: "2026-01", day: 5, ...rest,
});
const installment = (id, amount, number, count) => ({
  id, date: "2026-11-10", description: id, amount, kind: "expense", category: "Compras", status: "planned",
  source: "installment", cardId: "nu", invoiceMonth: "2026-11", installmentNumber: number, installmentCount: count,
});

/** Salary 6.000, rent 1.800, a 300 installment ending in Jan, variable spending around 2.000. */
const dashboard = (rest = {}) => ({
  month: "2026-11",
  profile: { name: "Teste" },
  received: 600000, expectedIncome: 600000, expenses: 250000, toPay: 100000, projectedSurplus: 150000,
  goal: 50000, budget: 400000,
  targets: [{ id: "t", name: "Viagem", amount: 600000, saved: 100000 }],
  valuations: [], saved: 0, cashIn: 0, cashOut: 0, invested: 0, recent: [], upcoming: [],
  installments: [installment("fone", -30000, 1, 3)],
  // 1.800 rent + 300 installment + 2.000 variable = 4.100 a month.
  trend: [
    { month: "2026-09", income: 600000, expenses: 410000 },
    { month: "2026-10", income: 600000, expenses: 410000 },
    { month: "2026-11", income: 100000, expenses: 50000 },
  ],
  categories: [],
  accounts: [],
  cards: [{ id: "nu", name: "Nubank", closingDay: 3, dueDay: 10, availableLimit: 500000, creditLimit: 800000 }],
  investments: [{ id: "i", institution: "X", name: "CDB", contributed: 1800000, value: 2000000, updatedOn: "2026-11-01" }],
  recurrences: [rule("salario", 600000, { category: "Salário" }), rule("aluguel", -180000)],
  invoices: [],
  coverage: [],
  ...rest,
});

test("a 4.000 TV in 10x on the card follows the invoice month and the running installments", () => {
  const sim = simulatePurchase(dashboard(), { total: 400000, count: 10, mode: "card", cardId: "nu", today: "2026-11-21" });
  // Bought after the 3rd (closing day): the charge joins the December invoice.
  assert.equal(sim.firstMonth, "2026-12");
  assert.equal(sim.lastMonth, "2027-09");
  assert.equal(sim.installment, 40000);
  assert.equal(sim.months.length, 10);
  const [december, january, february] = sim.months;
  // 6.000 − 1.800 − 300 (fone until January) − 2.000 variable = 1.900; minus the 400 installment.
  assert.deepEqual([december.surplus, december.after], [190000, 150000]);
  assert.equal(january.installments, 30000);
  assert.equal(february.installments, 0);
  assert.equal(february.after, 180000);
  assert.equal(sim.tightest.month, "2026-12");
  assert.deepEqual(sim.negativeMonths, []);
  assert.deepEqual(sim.monthsBelowGoal, []);
  assert.equal(sim.fitsLimit, true);
  assert.equal(sim.investedShare, 0.2);
});

test("installments split the leftover cents over the first payments", () => {
  const sim = simulatePurchase(dashboard(), { total: 100000, count: 3, mode: "account", today: "2026-11-21" });
  assert.equal(sim.firstMonth, "2026-12");
  assert.deepEqual(sim.months.map(({ payment }) => payment), [33334, 33333, 33333]);
});

test("a purchase that does not fit shows the negative months and the missed savings goal", () => {
  const sim = simulatePurchase(dashboard(), { total: 900000, count: 4, mode: "card", cardId: "nu", today: "2026-11-21" });
  assert.equal(sim.installment, 225000);
  // 1.900 and 2.200 of surplus against 2.250 installments: every month goes negative.
  assert.deepEqual(sim.negativeMonths, ["2026-12", "2027-01", "2027-02", "2027-03"]);
  assert.equal(sim.monthsBelowGoal.length, 4);
  assert.equal(sim.fitsLimit, false);
  const text = describeSimulation(sim);
  assert.match(text, /Meses que ficam negativos: 2026-12, 2027-01, 2027-02, 2027-03/);
  assert.match(text, /NÃO cabe/);
});

test("cash payments land in the current month and compare to the investments", () => {
  const sim = simulatePurchase(dashboard(), { total: 400000, count: 10, mode: "cash", today: "2026-11-21" });
  assert.equal(sim.count, 1);
  assert.equal(sim.firstMonth, "2026-11");
  assert.equal(sim.months[0].payment, 400000);
  assert.equal(sim.availableLimit, null);
  assert.match(describeSimulation(sim), /20% desse valor/);
});

test("goals take longer while the installments run", () => {
  const data = dashboard({ targets: [{ id: "t", name: "Carro", amount: 2000000, saved: 100000 }] });
  const sim = simulatePurchase(data, { total: 400000, count: 10, mode: "card", cardId: "nu", today: "2026-11-21" });
  const [car] = sim.targets;
  // 19.000 left: 9 months at the 2.140 average surplus; 17.400 saved during the 10 installments, then 1 more.
  assert.equal(car.remaining, 1900000);
  assert.equal(car.monthsBefore, 9);
  assert.equal(car.monthsAfter, 11);
});

test("without income rules the average of closed months is used", () => {
  const data = dashboard({ recurrences: [rule("aluguel", -180000)] });
  const sim = simulatePurchase(data, { total: 120000, count: 2, mode: "account", today: "2026-11-21" });
  assert.equal(sim.months[0].income, 600000);
  assert.match(sim.assumptions[0], /média dos últimos 2 meses/);
});

test("the summary lists the month, installments, goals and investments", () => {
  const text = financialSummary(dashboard());
  assert.match(text, /mês 2026-11/);
  assert.match(text, /fone 1\/3/);
  assert.match(text, /Viagem/);
  assert.match(text, /CDB/);
});
