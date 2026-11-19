import type { Dashboard, Entry, Recurrence } from "../contracts.ts";
import { shiftMonth } from "../date.ts";

/** Subscriptions are recurring expenses in the "Assinaturas" category, the same one merchants and imports use. */
export const SUBSCRIPTION_CATEGORY = "Assinaturas";
export const isSubscription = (category: string) =>
  category.trim().toLocaleLowerCase("pt-BR") === SUBSCRIPTION_CATEGORY.toLocaleLowerCase("pt-BR");

const isOutflow = (entry: Entry) => entry.kind === "expense" || entry.kind === "refund";

export type RecurringGroup = "fixed" | "subscriptions" | "income";

export interface RecurringItem {
  rule: Recurrence;
  /** This month's occurrence while it is still planned; absent once it was paid or received. */
  pending?: Entry;
  /** False when the rule only starts in a later month. */
  started: boolean;
}

/** Recurring rules still running in `month`, split into fixed bills, subscriptions and income. */
export function recurringGroups(data: Pick<Dashboard, "recurrences" | "upcoming">, month: string) {
  const groups: Record<RecurringGroup, RecurringItem[]> = { fixed: [], subscriptions: [], income: [] };
  for (const rule of data.recurrences) {
    if (rule.endMonth && rule.endMonth < month) continue;
    const group: RecurringGroup =
      rule.kind === "income" ? "income" : isSubscription(rule.category) ? "subscriptions" : "fixed";
    groups[group].push({
      rule,
      pending: data.upcoming.find((entry) => entry.recurrenceId === rule.id),
      started: rule.startMonth <= month,
    });
  }
  for (const items of Object.values(groups)) items.sort((a, b) => a.rule.day - b.rule.day);
  return groups;
}

/** Monthly cost of the rules already running in the month (positive cents). */
export const monthlyTotal = (items: RecurringItem[]) =>
  items.reduce((sum, { rule, started }) => sum + (started ? Math.abs(rule.amount) : 0), 0);

export interface InstallmentPlan {
  entry: Entry;
  number: number;
  count: number;
  /** This month's installment (positive cents). */
  amount: number;
  /** Installments after this month's one, and what they add up to. */
  left: number;
  leftAmount: number;
  lastMonth: string;
}

/** One plan per purchase: each month holds a single installment of it, so this month's entry is enough. */
export function installmentPlans(installments: Entry[]): InstallmentPlan[] {
  return installments
    .filter((entry) => entry.installmentCount && entry.installmentNumber)
    .map((entry) => {
      const count = entry.installmentCount!;
      const number = Math.min(entry.installmentNumber!, count);
      const amount = Math.abs(entry.amount);
      const left = count - number;
      const month = (entry.invoiceMonth ?? entry.date).slice(0, 7);
      return { entry, number, count, amount, left, leftAmount: left * amount, lastMonth: shiftMonth(month, left) };
    })
    .sort((a, b) => a.left - b.left || b.amount - a.amount);
}

export interface MonthBreakdown {
  fixed: number;
  subscriptions: number;
  oneOff: number;
  invoices: number;
}

/** Splits what is still to pay in the month (the same total as `toPay`) by kind of commitment. */
export function monthBreakdown(data: Pick<Dashboard, "upcoming" | "invoices">): MonthBreakdown {
  const parts: MonthBreakdown = { fixed: 0, subscriptions: 0, oneOff: 0, invoices: 0 };
  for (const entry of data.upcoming) {
    if (entry.cardId || !isOutflow(entry)) continue;
    const part = !entry.recurrenceId ? "oneOff" : isSubscription(entry.category) ? "subscriptions" : "fixed";
    parts[part] -= entry.amount;
  }
  parts.invoices = data.invoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0);
  return parts;
}

/** Planned entries that happen once: not part of a rule, a card invoice or an installment plan. */
export const oneOffEntries = (upcoming: Entry[]) =>
  upcoming
    .filter((entry) => !entry.cardId && !entry.recurrenceId && !entry.installmentCount)
    .sort((a, b) => a.date.localeCompare(b.date));
