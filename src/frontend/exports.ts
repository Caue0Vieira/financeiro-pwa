import type { Account, Card, Entry } from "../contracts.ts";
import { monthLabel } from "../summary.ts";
import { fit, page, PdfDocument } from "./pdf.ts";

/**
 * Data export: a CSV of any period (for the income tax return and backups) and a simple PDF of
 * one month, both built in the browser from the entries the app already loads.
 */

const kinds: Record<Entry["kind"], string> = {
  income: "Receita", expense: "Despesa", transfer: "Transferência", card_payment: "Pagamento de cartão",
  investment: "Investimento", saving: "Reserva", refund: "Estorno", uncategorized: "Não classificado",
};
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (cents: number) => currency.format(cents / 100).replace(/ /g, " ");
const brDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

type Names = { accounts: readonly Account[]; cards: readonly Card[] };
export const sourceName = (entry: Entry, { accounts, cards }: Names) =>
  (entry.cardId && cards.find(({ id }) => id === entry.cardId)?.name)
  || (entry.accountId && accounts.find(({ id }) => id === entry.accountId)?.name)
  || "";

/** CSV for spreadsheets in Portuguese: ";" between fields, decimal comma, BOM so Excel reads UTF-8. */
export function entriesCsv(entries: readonly Entry[], names: Names) {
  const cell = (value: string) => (/[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const header = ["Data", "Descrição", "Valor", "Tipo", "Categoria", "Situação", "Conta ou cartão", "Fatura", "Parcela", "Tags"];
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description, "pt-BR"))
    .map((entry) => [
      brDate(entry.date),
      entry.description,
      (entry.amount / 100).toFixed(2).replace(".", ","),
      kinds[entry.kind] ?? entry.kind,
      entry.category,
      entry.status === "planned" ? "Previsto" : "Confirmado",
      sourceName(entry, names),
      entry.invoiceMonth ? `${entry.invoiceMonth.slice(5, 7)}/${entry.invoiceMonth.slice(0, 4)}` : "",
      entry.installmentCount ? `${entry.installmentNumber ?? ""}/${entry.installmentCount}` : "",
      (entry.tags ?? []).join(", "),
    ].map(cell).join(";"));
  return `﻿${[header.join(";"), ...rows].join("\r\n")}\r\n`;
}

const isExpense = (entry: Entry) => entry.kind === "expense" || entry.kind === "refund";

/** Totals shown at the top of the PDF (confirmed entries only, like the dashboard). */
export function monthTotals(entries: readonly Entry[]) {
  const confirmed = entries.filter((entry) => entry.status === "confirmed");
  const income = confirmed.filter((entry) => entry.kind === "income").reduce((sum, entry) => sum + entry.amount, 0);
  // "|| 0" keeps an empty month at 0 instead of -0 ("-R$ 0,00").
  const expenses = -confirmed.filter(isExpense).reduce((sum, entry) => sum + entry.amount, 0) || 0;
  const categories = new Map<string, number>();
  for (const entry of confirmed.filter(isExpense)) {
    const name = entry.category.trim() || "Sem categoria";
    categories.set(name, (categories.get(name) ?? 0) - entry.amount);
  }
  return {
    income,
    expenses,
    balance: income - expenses,
    categories: [...categories].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

/** One-month report: totals, spending by category and every entry. */
export function monthPdf(month: string, entries: readonly Entry[], names: Names, generatedOn: string) {
  const pdf = new PdfDocument();
  const left = page.margin;
  const right = page.width - page.margin;
  const bottom = page.height - page.margin - 14;
  const totals = monthTotals(entries);
  let y = page.margin + 10;

  pdf.text(left, y, `Extrato de ${monthLabel(month)}`, { size: 18, bold: true });
  y += 16;
  pdf.text(left, y, `Nítido · gerado em ${brDate(generatedOn)} · valores em reais`, { size: 9, gray: 0.4 });
  y += 26;

  for (const [label, value] of [["Entradas", totals.income], ["Saídas", totals.expenses], ["Saldo", totals.balance]] as const) {
    pdf.text(left, y, label, { size: 11 });
    pdf.text(left + 200, y, money(value), { size: 11, bold: label === "Saldo", align: "right" });
    y += 16;
  }
  y += 10;

  if (totals.categories.length) {
    pdf.text(left, y, "Gastos por categoria", { size: 12, bold: true });
    y += 16;
    for (const { name, amount } of totals.categories) {
      pdf.text(left, y, fit(name, 150, 10), { size: 10 });
      pdf.text(left + 200, y, money(amount), { size: 10, align: "right" });
      pdf.text(left + 210, y, `${Math.round((amount / (totals.expenses || 1)) * 100)}%`, { size: 9, gray: 0.45 });
      y += 14;
    }
    y += 12;
  }

  const columns = { date: left, description: left + 52, category: left + 250, source: left + 350, amount: right };
  const header = () => {
    pdf.text(columns.date, y, "Data", { size: 9, bold: true, gray: 0.35 });
    pdf.text(columns.description, y, "Descrição", { size: 9, bold: true, gray: 0.35 });
    pdf.text(columns.category, y, "Categoria", { size: 9, bold: true, gray: 0.35 });
    pdf.text(columns.source, y, "Conta ou cartão", { size: 9, bold: true, gray: 0.35 });
    pdf.text(columns.amount, y, "Valor", { size: 9, bold: true, gray: 0.35, align: "right" });
    y += 6;
    pdf.line(left, y, right, y);
    y += 13;
  };
  pdf.text(left, y, `Lançamentos (${entries.length})`, { size: 12, bold: true });
  y += 18;
  header();
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description, "pt-BR"));
  for (const entry of sorted) {
    if (y > bottom) {
      pdf.addPage();
      y = page.margin + 10;
      header();
    }
    const planned = entry.status === "planned";
    const gray = planned ? 0.45 : 0;
    pdf.text(columns.date, y, `${entry.date.slice(8, 10)}/${entry.date.slice(5, 7)}`, { size: 9, gray });
    pdf.text(columns.description, y, fit(`${entry.description}${planned ? " (previsto)" : ""}`, 190, 9), { size: 9, gray });
    pdf.text(columns.category, y, fit(entry.category, 92, 9), { size: 9, gray });
    pdf.text(columns.source, y, fit(sourceName(entry, names), 90, 9), { size: 9, gray });
    pdf.text(columns.amount, y, money(entry.amount), { size: 9, gray, align: "right" });
    y += 14;
  }
  if (!sorted.length) pdf.text(left, y, "Nenhum lançamento neste mês.", { size: 10, gray: 0.45 });

  for (let index = 0; index < pdf.pageCount; index++) {
    pdf.text(right, page.height - 24, `Página ${index + 1} de ${pdf.pageCount}`, { size: 8, gray: 0.5, align: "right", pageIndex: index });
  }
  return pdf.bytes();
}

/** Saves a file: the share sheet where it exists (iPhone app), a download otherwise. */
export async function saveFile(data: BlobPart, name: string, type: string) {
  const file = new File([data], name, { type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
