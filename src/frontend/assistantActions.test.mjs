import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMoney, parsePurchaseQuestion, proposalFromSimulation, proposalProblem, proposalsFrom, purchaseName,
  splitAnswer, toMutations, visibleAnswer,
} from "./assistantActions.ts";

const cards = [
  { id: "nu", name: "Nubank", closingDay: 3, dueDay: 10 },
  { id: "inter", name: "Cartão Inter", closingDay: 25, dueDay: 5 },
];
const today = "2026-11-21";

test("money in the ways people type it", () => {
  assert.equal(parseMoney("R$ 4.000,00"), 400000);
  assert.equal(parseMoney("4000"), 400000);
  assert.equal(parseMoney("1.500,5"), 150050);
  assert.equal(parseMoney("4 mil"), 400000);
  assert.equal(parseMoney("4k"), 400000);
  assert.equal(parseMoney(1500.5), 150050);
  assert.equal(parseMoney("abc"), undefined);
});

test("purchase questions become simulations", () => {
  assert.deepEqual(parsePurchaseQuestion("Posso comprar uma TV de 4 mil em 10x no Nubank?", cards),
    { total: 400000, count: 10, mode: "card", cardId: "nu" });
  assert.deepEqual(parsePurchaseQuestion("vale a pena comprar um sofá de R$ 2.500 à vista?", cards),
    { total: 250000, count: 1, mode: "cash", cardId: undefined });
  assert.deepEqual(parsePurchaseQuestion("e se eu parcelar 12 vezes no boleto uma moto de 18000", cards),
    { total: 1800000, count: 12, mode: "account", cardId: undefined });
  // "parcela de 400 em 10x" is the installment, not the total.
  assert.equal(parsePurchaseQuestion("vou assumir parcela de R$ 400 em 10x no inter", cards).total, 400000);
  assert.equal(parsePurchaseQuestion("vou assumir parcela de R$ 400 em 10x no inter", cards).cardId, "inter");
  assert.equal(parsePurchaseQuestion("como estou este mês?", cards), null);
  assert.equal(parsePurchaseQuestion("vou receber 1500 de freela", cards), null);
});

test("item names come from the question", () => {
  assert.equal(purchaseName("Posso comprar uma TV de 4 mil em 10x?"), "TV");
  assert.equal(purchaseName("quero comprar um notebook novo por 5000"), "Notebook novo");
  assert.equal(purchaseName("cabe 4000 em 10x?"), "Compra");
});

const answer = `Anotei duas coisas para você confirmar.
\`\`\`acoes
[{"tipo":"receita","descricao":"Freela","valor":1500,"mes":"2026-12"},
 {"tipo":"parcelado","descricao":"TV","valor_parcela":400,"parcelas":10,"cartao":"Nubank"},
 {"tipo":"recorrente","natureza":"despesa","descricao":"Academia","valor":"120,00","dia":10},
 {"tipo":"apagar","descricao":"tudo"}]
\`\`\``;

test("the actions block is hidden while streaming and parsed at the end", () => {
  assert.equal(visibleAnswer(answer), "Anotei duas coisas para você confirmar.");
  assert.equal(visibleAnswer("Texto em andamento\n``"), "Texto em andamento");
  const { text, raw } = splitAnswer(answer);
  assert.equal(text, "Anotei duas coisas para você confirmar.");
  assert.equal(raw.length, 4);
  assert.deepEqual(splitAnswer("Sem ações aqui.").raw, []);
  assert.deepEqual(splitAnswer("Quebrado\n```acoes\n[{").raw, []);
});

test("proposals are validated, unknown kinds dropped and capped at three", () => {
  const proposals = proposalsFrom(splitAnswer(answer).raw, { cards, today });
  assert.equal(proposals.length, 3);
  const [income, tv, gym] = proposals.map(({ action }) => action);
  assert.deepEqual(income, { type: "once", flow: "income", description: "Freela", amount: 150000, date: "2026-12-05", category: "Receitas" });
  // Bought on the 21st, after the Nubank closing day (3): first installment on the December invoice.
  assert.equal(tv.type, "installments");
  assert.deepEqual([tv.total, tv.count, tv.cardId, tv.firstMonth], [400000, 10, "nu", "2026-12"]);
  assert.deepEqual([gym.flow, gym.amount, gym.day, gym.startMonth], ["expense", 12000, 10, "2026-12"]);
  assert.ok(proposals.every(({ status }) => status === "pending"));
});

test("months far away or malformed fall back to next month", () => {
  const [far] = proposalsFrom([{ tipo: "despesa", descricao: "X", valor: 10, mes: "2035-01" }], { cards, today });
  assert.equal(far.action.date.slice(0, 7), "2026-12");
});

test("installments without a known card wait for the card choice", () => {
  const [action] = proposalsFrom([{ tipo: "parcelado", descricao: "Celular", valor_total: 3000, parcelas: 6 }], { cards, today }).map((p) => p.action);
  assert.equal(action.cardId, "");
  assert.equal(proposalProblem(action), "Escolha o cartão.");
  assert.equal(proposalProblem({ ...action, cardId: "nu" }), "");
});

test("confirmed proposals become the same mutations the screens send", () => {
  const [income, tv, gym] = proposalsFrom(splitAnswer(answer).raw, { cards, today }).map(({ action }) => action);
  assert.deepEqual(toMutations(income, today), [{
    type: "saveEntry",
    entry: { date: "2026-12-05", description: "Freela", amount: 150000, kind: "income", status: "planned", category: "Receitas" },
  }]);
  assert.deepEqual(toMutations(tv, today), [{
    type: "addInstallments", cardId: "nu", description: "TV", category: "Compras", total: 400000, count: 10, firstMonth: "2026-12",
  }]);
  assert.equal(toMutations(gym, today)[0].recurrence.amount, -12000);
  const boleto = toMutations({ type: "installments", description: "Moto", total: 100000, count: 3, payWith: "account", cardId: "", firstMonth: "2026-12", category: "Compras" }, today);
  assert.deepEqual(boleto.map(({ entry }) => [entry.date, entry.description, entry.amount]), [
    ["2026-12-21", "Moto (1/3)", -33334], ["2027-01-21", "Moto (2/3)", -33333], ["2027-02-21", "Moto (3/3)", -33333],
  ]);
});

test("a simulation can be recorded as it was simulated", () => {
  const sim = { mode: "card", count: 10, total: 400000, firstMonth: "2026-12" };
  const { action } = proposalFromSimulation(sim, "nu", "TV", today);
  assert.deepEqual([action.type, action.cardId, action.firstMonth, action.count], ["installments", "nu", "2026-12", 10]);
  const cash = proposalFromSimulation({ mode: "cash", count: 1, total: 250000, firstMonth: "2026-11" }, undefined, "Sofá", today).action;
  assert.deepEqual([cash.type, cash.date, cash.amount], ["once", today, 250000]);
});
