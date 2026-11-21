import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMoney, parsePurchaseQuestion, parseQuickEntry, proposalFromSimulation, proposalProblem, proposalsFrom, purchaseName,
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

const accounts = [{ id: "bb", name: "Banco do Brasil" }];
const known = { ifood: "iFood", uber: "Uber" };
const quick = (text, extra = {}) => parseQuickEntry(text, {
  cards, accounts, today,
  categorize: (description) => ({ iFood: "Alimentação", Uber: "Transporte" })[description] ?? "",
  merchantName: (description) => known[description.toLowerCase()],
  ...extra,
});

test("quick entry: what was spent, where, when and how it was paid", () => {
  assert.deepEqual(quick("gastei 45 no ifood ontem no nubank"), {
    type: "entry", flow: "expense", description: "iFood", amount: 4500, date: "2026-11-20", category: "Alimentação", payWith: "card:nu",
  });
  assert.deepEqual(quick("Paguei R$ 23,90 de uber hoje no pix"), {
    type: "entry", flow: "expense", description: "Uber", amount: 2390, date: today, category: "Transporte", payWith: "account:bb",
  });
  const padaria = quick("gastei 18,50 na padaria São João dia 12 no banco do brasil");
  assert.deepEqual([padaria.description, padaria.amount, padaria.date, padaria.payWith, padaria.category], ["Padaria São João", 1850, "2026-11-12", "account:bb", "Compras"]);
  // Dates: day after today is last month; dd/mm; weekdays go back to the last one.
  assert.equal(quick("gastei 30 no mercado dia 25").date, "2026-10-25");
  assert.equal(quick("comprei um livro de 80 reais em 03/11").date, "2026-11-03");
  assert.equal(quick("gastei 50 com gasolina na sexta").date, "2026-11-20");
  assert.equal(quick("gastei 50 com gasolina no sábado").date, "2026-11-14");
  assert.equal(quick("gastei 50 com gasolina na sexta").description, "Gasolina");
});

test("quick entry: income, installments and what is not an entry", () => {
  const freela = quick("recebi 1.500 de freela");
  assert.deepEqual([freela.type, freela.flow, freela.description, freela.amount, freela.category], ["entry", "income", "Freela", 150000, "Receitas"]);
  const tv = quick("comprei uma TV de 3 mil em 10x no inter");
  assert.deepEqual([tv.type, tv.description, tv.total, tv.count, tv.cardId, tv.firstMonth], ["installments", "TV", 300000, 10, "inter", "2026-12"]);
  assert.equal(quick("posso gastar 300 no shopping?"), null);
  assert.equal(quick("quanto gastei no ifood"), null);
  assert.equal(quick("gastei muito este mês"), null);
  assert.equal(quick("como estou?"), null);
});

test("an entry is saved confirmed, on the card's invoice when paid by card", () => {
  const [onCard] = toMutations(quick("gastei 45 no ifood ontem no nubank"), today, cards);
  // Nubank closes on the 3rd: a purchase on Nov 20 goes to the December invoice.
  assert.deepEqual(onCard.entry, {
    date: "2026-11-20", description: "iFood", amount: -4500, kind: "expense", status: "confirmed", category: "Alimentação",
    accountId: undefined, cardId: "nu", invoiceMonth: "2026-12",
  });
  const [income] = toMutations(quick("recebi 300 de freela no pix"), today, cards);
  assert.deepEqual([income.entry.amount, income.entry.accountId, income.entry.cardId], [30000, "bb", undefined]);
});

test("the AI can propose a quick entry too", () => {
  const [entry] = proposalsFrom([{ tipo: "gasto", descricao: "Padaria", valor: "12,50", data: "2026-11-19", pagamento: "nubank" }], { cards, today, accounts })
    .map(({ action }) => action);
  assert.deepEqual(entry, { type: "entry", flow: "expense", description: "Padaria", amount: 1250, date: "2026-11-19", category: "Compras", payWith: "card:nu" });
  const [future] = proposalsFrom([{ tipo: "recebido", descricao: "Pix", valor: 10, data: "2027-01-01" }], { cards, today }).map(({ action }) => action);
  assert.equal(future.date, today);
});
