import type { Action, Card, Dashboard } from "../contracts.ts";
import { dateInMonth, invoiceMonthOf, shiftMonth } from "../date.ts";
import type { PaymentMode, PurchaseInput, PurchaseSimulation } from "./purchase.ts";

/**
 * What the assistant can turn into records. The AI only proposes (a ```acoes block at the end of
 * its answer); the app validates it here and shows a confirmation card. Nothing is saved until the
 * user taps "Cadastrar", and then it goes through the same mutate() the screens use.
 */

export type Flow = "income" | "expense";

export type ProposedAction =
  | { type: "once"; flow: Flow; description: string; amount: number; date: string; category: string }
  | {
      type: "installments";
      description: string;
      total: number;
      count: number;
      payWith: "card" | "account";
      /** Empty when the card still has to be picked. */
      cardId: string;
      firstMonth: string;
      category: string;
    }
  | { type: "recurring"; flow: Flow; description: string; amount: number; day: number; startMonth: string; category: string };

export interface Proposal {
  id: string;
  action: ProposedAction;
  status: "pending" | "saved" | "discarded";
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const maxCents = 100_000_000_00;
const maxActions = 3;

/** "R$ 4.000,00", "4000", "1.500,5", "4 mil", "4k", or a number in reais from the AI → cents. */
export function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : undefined;
  if (typeof value !== "string") return undefined;
  const match = fold(value).match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(mil|k)?\b/);
  if (!match) return undefined;
  const reais = Number(match[1].replace(/\./g, "")) + (match[2] ? Number(match[2].padEnd(2, "0")) / 100 : 0);
  const cents = Math.round(reais * (match[3] ? 1000 : 1) * 100);
  return cents > 0 ? cents : undefined;
}

/** Card mentioned by name ("no Nubank", "cartão inter"). */
export function findCard(text: string, cards: readonly Card[]) {
  const folded = fold(text);
  return cards.find((card) =>
    fold(card.name)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && word !== "cartao" && word !== "credito")
      .some((word) => new RegExp(`\\b${word}\\b`).test(folded)),
  );
}

/** Item name in "comprar uma TV de 4 mil" → "TV". */
export function purchaseName(text: string) {
  const match = text.match(/compr\w*\s+(?:(?:um|uma|o|a|os|as)\s+)?(.{2,40}?)\s+(?:de|por|em|no|na|à|a|parcelad\w*|com)\s/i);
  const name = match?.[1]?.trim();
  return name && !/\d/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : "Compra";
}

/**
 * Recognises a purchase question ("posso comprar uma TV de 4 mil em 10x no Nubank?") so the app
 * can run the simulation before asking the AI. Null when the message isn't about buying something.
 */
export function parsePurchaseQuestion(text: string, cards: readonly Card[]): PurchaseInput | null {
  const folded = fold(text);
  if (!/(compr|parcel|a vista|vale a pena|posso gastar|cabe no)/.test(folded)) return null;
  if (/(ganh|receb|salario|freela)/.test(folded) && !/compr/.test(folded)) return null;
  const countMatch = folded.match(/(\d{1,2})\s*(?:x|vezes|parcelas)\b/);
  const count = countMatch ? Number(countMatch[1]) : 1;
  const rest = countMatch ? folded.replace(countMatch[0], " ") : folded;
  const perInstallment = rest.match(/parcelas?\s+de\s+((?:r\$\s*)?[\d.,]+\s*(?:mil|k)?)/);
  const amounts = [...rest.matchAll(/(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(mil|k)?\b/g)]
    .map((match) => ({ cents: parseMoney(match[0]) ?? 0, explicit: Boolean(match[1] || match[3]) }))
    .filter(({ cents }) => cents >= 1000);
  const chosen = amounts.find(({ explicit }) => explicit) ?? amounts.sort((a, b) => b.cents - a.cents)[0];
  const value = perInstallment ? parseMoney(perInstallment[1]) : chosen?.cents;
  if (!value) return null;
  const total = perInstallment ? value * count : value;

  const card = findCard(text, cards);
  let mode: PaymentMode;
  if (/(a vista|pix|debito|dinheiro)/.test(folded)) mode = "cash";
  else if (/(boleto|carne|crediario)/.test(folded)) mode = "account";
  else if (card || /(cartao|credito)/.test(folded)) mode = cards.length ? "card" : "account";
  else if (count > 1) mode = cards.length ? "card" : "account";
  else mode = "cash";
  return { total, count: mode === "cash" ? 1 : count, mode, cardId: mode === "card" ? (card ?? cards[0])?.id : undefined };
}

/** Text shown while the answer streams: everything before the actions block. */
export const visibleAnswer = (text: string) =>
  text.split(/```\s*a[cç][oõ]es/i)[0].replace(/`{1,3}[a-zçõ]*\s*$/i, "").trimEnd();

/** Splits the final answer into what is shown and the raw actions the AI proposed. */
export function splitAnswer(text: string): { text: string; raw: unknown[] } {
  const match = text.match(/```\s*a[cç][oõ]es\s*([\s\S]*?)(?:```|$)/i);
  if (!match) return { text: text.trim(), raw: [] };
  let raw: unknown = [];
  try {
    raw = JSON.parse(match[1].trim());
  } catch {
    raw = [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { acoes?: unknown }).acoes) ? (raw as { acoes: unknown[] }).acoes : [];
  return { text: visibleAnswer(text), raw: list };
}

type Context = Pick<Dashboard, "cards"> & { today: string };

const text = (value: unknown, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const monthOf = (value: unknown, fallback: string, today: string) => {
  const month = text(value, 7);
  const current = today.slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= shiftMonth(current, -1) && month <= shiftMonth(current, 36) ? month : fallback;
};
const dayOf = (value: unknown, fallback: number) => {
  const day = Math.round(Number(value));
  return day >= 1 && day <= 31 ? day : fallback;
};
const flowOf = (value: unknown): Flow | undefined => {
  const folded = fold(text(value));
  return folded.startsWith("receita") || folded === "income" ? "income" : folded.startsWith("despesa") || folded === "expense" ? "expense" : undefined;
};

/** First invoice a card purchase made today falls into (next month when the card has no dates). */
export function firstCardMonth(card: Card | undefined, today: string) {
  return invoiceMonthOf(today, card?.closingDay ?? null, card?.dueDay ?? null) ?? shiftMonth(today.slice(0, 7), 1);
}

/** Validates one action the AI proposed; null when it can't be used. */
export function toProposed(raw: unknown, { cards, today }: Context): ProposedAction | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const kind = fold(text(item.tipo));
  const description = text(item.descricao) || text(item.description);
  const category = text(item.categoria, 40);
  const nextMonth = shiftMonth(today.slice(0, 7), 1);
  if (!description) return null;

  if (kind === "receita" || kind === "despesa") {
    const amount = parseMoney(item.valor);
    if (!amount || amount > maxCents) return null;
    const month = monthOf(item.mes, nextMonth, today);
    const flow: Flow = kind === "receita" ? "income" : "expense";
    return {
      type: "once", flow, description, amount,
      date: dateInMonth(month, dayOf(item.dia, month === today.slice(0, 7) ? Number(today.slice(8, 10)) : 5)),
      category: category || (flow === "income" ? "Receitas" : "Contas"),
    };
  }
  if (kind === "parcelado" || kind === "parcelas") {
    const count = Math.round(Number(item.parcelas));
    if (!(count >= 2 && count <= 48)) return null;
    const perInstallment = parseMoney(item.valor_parcela);
    const total = parseMoney(item.valor_total) ?? (perInstallment ? perInstallment * count : parseMoney(item.valor));
    if (!total || total > maxCents || total < count) return null;
    const cardText = text(item.cartao);
    const card = cardText ? findCard(cardText, cards) ?? undefined : undefined;
    const payWith = fold(cardText).match(/boleto|carne|crediario/) || !cards.length ? "account" : "card";
    return {
      type: "installments", description, total, count, payWith,
      cardId: payWith === "card" ? (card?.id ?? (cards.length === 1 ? cards[0].id : "")) : "",
      firstMonth: monthOf(item.mes_inicio ?? item.mes, payWith === "card" ? firstCardMonth(card, today) : nextMonth, today),
      category: category || "Compras",
    };
  }
  if (kind === "recorrente") {
    const amount = parseMoney(item.valor);
    const flow = flowOf(item.natureza) ?? "expense";
    if (!amount || amount > maxCents) return null;
    return {
      type: "recurring", flow, description, amount,
      day: dayOf(item.dia, 5),
      startMonth: monthOf(item.mes_inicio ?? item.mes, nextMonth, today),
      category: category || (flow === "income" ? "Receitas" : "Contas"),
    };
  }
  return null;
}

export function proposalsFrom(raw: unknown[], context: Context): Proposal[] {
  return raw
    .map((item) => toProposed(item, context))
    .filter((action): action is ProposedAction => action !== null)
    .slice(0, maxActions)
    .map((action) => ({ id: crypto.randomUUID(), action, status: "pending" }));
}

/** "Cadastrar esta compra" after a simulation: the same purchase, ready to confirm. */
export function proposalFromSimulation(sim: PurchaseSimulation, cardId: string | undefined, description: string, today: string): Proposal {
  const action: ProposedAction =
    sim.mode === "cash"
      ? { type: "once", flow: "expense", description, amount: sim.total, date: today, category: "Compras" }
      : sim.count === 1
        ? { type: "once", flow: "expense", description, amount: sim.total, date: dateInMonth(sim.firstMonth, Number(today.slice(8, 10))), category: "Compras" }
        : {
            type: "installments", description, total: sim.total, count: sim.count,
            payWith: sim.mode === "card" ? "card" : "account",
            cardId: sim.mode === "card" ? cardId ?? "" : "",
            firstMonth: sim.firstMonth, category: "Compras",
          };
  return { id: crypto.randomUUID(), action, status: "pending" };
}

/** Why the proposal can't be saved yet; empty when it can. */
export function proposalProblem(action: ProposedAction) {
  if (!action.description.trim()) return "Informe uma descrição.";
  const amount = action.type === "installments" ? action.total : action.amount;
  if (!amount || amount <= 0) return "Informe um valor.";
  if (action.type === "installments") {
    if (action.payWith === "card" && !action.cardId) return "Escolha o cartão.";
    if (!(action.count >= 2 && action.count <= 48)) return "Use de 2 a 48 parcelas.";
    if (action.total < action.count) return "O valor precisa cobrir pelo menos R$ 0,01 por parcela.";
  }
  return "";
}

/** The app actions that record a confirmed proposal (same shapes the screens send). */
export function toMutations(action: ProposedAction, today: string): Action[] {
  switch (action.type) {
    case "once":
      return [{
        type: "saveEntry",
        entry: {
          date: action.date, description: action.description.trim(),
          amount: action.flow === "income" ? action.amount : -action.amount,
          kind: action.flow, status: "planned", category: action.category,
        },
      }];
    case "recurring":
      return [{
        type: "saveRecurrence",
        recurrence: {
          description: action.description.trim(),
          amount: action.flow === "income" ? action.amount : -action.amount,
          kind: action.flow, category: action.category, day: action.day, startMonth: action.startMonth,
        },
      }];
    case "installments": {
      if (action.payWith === "card") {
        return [{
          type: "addInstallments", cardId: action.cardId, description: action.description.trim(),
          category: action.category, total: action.total, count: action.count, firstMonth: action.firstMonth,
        }];
      }
      // Boleto or carnê: one planned bill a month, numbered in the description.
      const base = Math.floor(action.total / action.count);
      const remainder = action.total - base * action.count;
      const day = Number(today.slice(8, 10));
      return Array.from({ length: action.count }, (_, index) => ({
        type: "saveEntry" as const,
        entry: {
          date: dateInMonth(shiftMonth(action.firstMonth, index), day),
          description: `${action.description.trim()} (${index + 1}/${action.count})`,
          amount: -(base + (index < remainder ? 1 : 0)),
          kind: "expense" as const, status: "planned" as const, category: action.category,
        },
      }));
    }
  }
}

/** Instructions for the AI on how to propose records (goes with the app context). */
export function actionsGuide(today: string, cards: readonly Card[]) {
  const month = today.slice(0, 7);
  return [
    `DATA: hoje é ${today}; mês atual ${month}; próximo mês ${shiftMonth(month, 1)}.`,
    `Cartões cadastrados: ${cards.filter((card) => !card.archived).map((card) => card.name).join(", ") || "nenhum"}.`,
  ].join("\n");
}
