import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billsDueTomorrow, budgetAlerts, composeNotices, defaultPreferences, dueKinds, invoicesClosing, knownPushService,
  largeExpenses, normalizePreferences, wants,
} from "./notices.ts";

const today = "2026-11-21";
/** Intl writes "R$" with a no-break space. */
const plain = (text) => text.replace(/ /g, " ");

test("preferences fill defaults and ignore junk", () => {
  assert.deepEqual(normalizePreferences(null), defaultPreferences);
  assert.deepEqual(normalizePreferences({ billDue: false, largeExpenseMin: 12000, extra: 1, budget: "sim" }),
    { ...defaultPreferences, billDue: false, largeExpenseMin: 12000 });
  assert.equal(normalizePreferences({ largeExpenseMin: 5 }).largeExpenseMin, defaultPreferences.largeExpenseMin);
});

test("notices wait for daytime in São Paulo", () => {
  assert.deepEqual(dueKinds(3), []);
  assert.deepEqual(dueKinds(7), ["large_expense"]);
  assert.deepEqual(dueKinds(9).sort(), ["bill_due", "budget", "invoice_closing", "large_expense", "monthly_summary", "negative_balance"]);
  assert.deepEqual(dueKinds(22).sort(), ["budget", "large_expense"]);
});

test("bills due tomorrow: planned bills and recurring ones not recorded yet", () => {
  const items = billsDueTomorrow(
    today,
    [
      { id: "luz", description: "Energia elétrica", amount: -16340, date: "2026-11-22" },
      { id: "depois", description: "Água", amount: -9000, date: "2026-11-23" },
      { id: "receita", description: "Freela", amount: 50000, date: "2026-11-22" },
    ],
    [
      { id: "internet", description: "Internet", amount: -11990, day: 22, startMonth: "2026-01-01" },
      { id: "academia", description: "Academia", amount: -9900, day: 22, startMonth: "2026-01-01" },
      { id: "fim", description: "Curso", amount: -20000, day: 22, startMonth: "2026-01-01", endMonth: "2026-10-01" },
      { id: "salario", description: "Salário", amount: 600000, day: 22, startMonth: "2026-01-01" },
    ],
    new Set(["academia:2026-11"]),
  );
  assert.deepEqual(items.map(({ ref, amount }) => [ref, amount]), [["luz", 16340], ["internet:2026-11-22", 11990]]);
  // Day 31 in a 30-day month falls on the 30th.
  const monthEnd = billsDueTomorrow("2026-11-29", [], [{ id: "r", description: "Aluguel", amount: -1, day: 31, startMonth: "2026-01" }], new Set());
  assert.equal(monthEnd[0].date, "2026-11-30");
});

test("invoices that close in two days, by card days or the month's adjustment", () => {
  const cards = [
    { id: "nu", name: "Nubank", closingDay: 23, dueDay: 30, billBalance: 123456 },
    { id: "inter", name: "Inter", closingDay: 25, dueDay: 5 },
    { id: "velho", name: "Antigo", closingDay: 23, dueDay: 30, archived: true },
    { id: "sem", name: "Sem datas", closingDay: null, dueDay: null },
  ];
  assert.deepEqual(invoicesClosing(today, cards, []).map(({ ref, amount }) => [ref, amount]), [["nu:2026-11-23", 123456]]);
  // Inter closes on the 25th for the invoice due Dec 5; moved to the 23rd this time.
  const moved = invoicesClosing(today, cards, [{ cardId: "inter", month: "2026-12", closingDate: "2026-11-23", dueDate: null }]);
  assert.deepEqual(moved.map(({ ref }) => ref), ["nu:2026-11-23", "inter:2026-11-23"]);
});

test("large expenses respect the minimum", () => {
  const rows = [
    { id: "a", description: "Mercado", amount: -49999, date: today },
    { id: "b", description: "Geladeira", amount: -389900, date: today },
  ];
  assert.deepEqual(largeExpenses(rows, 50000).map(({ ref }) => ref), ["b"]);
});

test("budget alerts at 80% and 100%, by category and for the month", () => {
  const items = budgetAlerts(
    "2026-11",
    [{ category: "Alimentação", spent: 61000 }, { category: "assinaturas ", spent: 17000 }, { category: "Lazer", spent: 1000 }],
    [{ category: "Alimentação", amount: 60000 }, { category: "Assinaturas", amount: 20000 }, { category: "Lazer", amount: 50000 }],
    90000,
  );
  assert.deepEqual(items.map(({ ref }) => ref), [
    "alimentacao:2026-11:80", "alimentacao:2026-11:100", "assinaturas:2026-11:80", "mes:2026-11:80",
  ]);
  assert.deepEqual(budgetAlerts("2026-11", [{ category: "Lazer", spent: 95000 }], [], 90000).map(({ ref }) => ref),
    ["mes:2026-11:80", "mes:2026-11:100"]);
  assert.deepEqual(budgetAlerts("2026-11", [], [{ category: "X", amount: 100 }]), []);
});

test("composed notices: one per kind, in Portuguese, opening the right screen", () => {
  const [bills, invoice, expense, budget] = composeNotices([
    ...billsDueTomorrow(today, [{ id: "luz", description: "Energia", amount: -16340, date: "2026-11-22" }],
      [{ id: "net", description: "Internet", amount: -11990, day: 22, startMonth: "2026-01" }], new Set()),
    ...invoicesClosing(today, [{ id: "nu", name: "Nubank", closingDay: 23, dueDay: 30, billBalance: 50000 }], []),
    ...largeExpenses([{ id: "g", description: "Geladeira", amount: -389900, date: "2026-11-20" }], 50000),
    ...budgetAlerts("2026-11", [{ category: "Alimentação", spent: 61000 }], [{ category: "Alimentação", amount: 60000 }]),
  ]);
  assert.equal(bills.title, "2 contas vencem amanhã");
  assert.equal(plain(bills.body), "Energia e Internet: R$ 283,30 no total.");
  assert.equal(bills.url, "/?abrir=commitments");
  assert.deepEqual(bills.refs, ["luz", "net:2026-11-22"]);
  assert.equal(plain(invoice.body), "A fatura do Nubank fecha em 23/11. Até agora: R$ 500,00.");
  assert.equal(plain(expense.title), "Gasto de R$ 3.899,00");
  assert.equal(expense.url, "/?abrir=activity");
  // 100% hides the 80% notice, but both are logged.
  assert.equal(budget.title, "Alimentação: limite ultrapassado");
  assert.equal(plain(budget.body), "R$ 610,00 de R$ 600,00 no mês.");
  assert.deepEqual(budget.refs, ["alimentacao:2026-11:80", "alimentacao:2026-11:100"]);
  assert.equal(composeNotices([]).length, 0);
  const [summary] = composeNotices([{ kind: "monthly_summary", ref: "2026-10", label: "outubro", amount: 0 }]);
  assert.equal(summary.title, "Seu resumo de outubro chegou");
  assert.equal(summary.url, "/?abrir=home");
  const [negative] = composeNotices([{ kind: "negative_balance", ref: "2026-11:2026-11-24", label: "Saldo", amount: 21990, date: "2026-11-24" }]);
  assert.equal(plain(negative.body), "Pela previsão, o saldo fica abaixo de zero no dia 24 e chega a -R$ 219,90. Veja o que vence até lá.");
});

test("a device only gets what it wants", () => {
  const [expense] = largeExpenses([{ id: "g", description: "TV", amount: -80000, date: today }], 100);
  assert.equal(wants(defaultPreferences, expense), true);
  assert.equal(wants({ ...defaultPreferences, largeExpenseMin: 100000 }, expense), false);
  assert.equal(wants({ ...defaultPreferences, largeExpense: false }, expense), false);
});

test("only real push services are accepted", () => {
  assert.ok(knownPushService("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(knownPushService("https://web.push.apple.com/QGuQy"));
  assert.ok(knownPushService("https://updates.push.services.mozilla.com/wpush/v2/x"));
  assert.ok(knownPushService("https://wns2-bl2p.notify.windows.com/w/?token=1"));
  assert.ok(!knownPushService("http://fcm.googleapis.com/x"));
  assert.ok(!knownPushService("https://evil.example/fcm.googleapis.com"));
  assert.ok(!knownPushService("https://fcm.googleapis.com.evil.example/x"));
  assert.ok(!knownPushService("demo:este-aparelho"));
});
