import type { EntryKind } from "../contracts";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (n: number) => currency.format((n || 0) / 100);
export const monthName = (s: string) =>
  new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
/** "Cartão Nubank", without repeating the word when the name already has it. */
export const cardLabel = (name: string) => (/^cart[aã]o(\s|$)/i.test(name.trim()) ? name : `Cartão ${name}`);
export const dateLabel = (s: string) =>
  s
    ? new Date(s + "T12:00:00")
        .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
        .replace(".", "")
    : "";
export const kindLabel: Record<EntryKind, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  card_payment: "Pagamento de cartão",
  investment: "Investimento",
  saving: "Reserva",
  refund: "Estorno",
  uncategorized: "Não classificado",
};
