import type { BalanceForecast, Entry, Invoice } from './contracts.ts';
import { addDays, dateInMonth } from './date.ts';

/**
 * Balance forecast for the current month, day by day: real up to today, projected after it.
 * The start is the accounts' balance from Open Finance when there is one ("bank"); otherwise the
 * month's own cash flow, starting at zero on day 1 ("month"). Card purchases don't move the account
 * until their invoice is paid, so they count through the open invoices on their due dates.
 */

export interface ForecastInput {
  today: string;
  /** The month's entries, confirmed and planned (bills, recurring income, installments on the account). */
  entries: Pick<Entry, 'date' | 'amount' | 'status' | 'cardId'>[];
  invoices: Pick<Invoice, 'dueDate' | 'total' | 'paid'>[];
  /** Sum of the accounts' balances today (Open Finance); undefined when unknown. */
  bankBalance?: number;
}

export function projectBalance({ today, entries, invoices, bankBalance }: ForecastInput): BalanceForecast {
  const month = today.slice(0, 7);
  const first = `${month}-01`;
  const last = dateInMonth(month, 31);
  // Card charges are paid through the invoice; everything else moves the account.
  const cash = entries.filter((entry) => !entry.cardId && entry.date >= first && entry.date <= last);
  const confirmed = cash.filter((entry) => entry.status === 'confirmed');
  const planned = cash.filter((entry) => entry.status === 'planned');

  const flowBy = new Map<string, number>();
  const add = (date: string, amount: number) => flowBy.set(date, (flowBy.get(date) ?? 0) + amount);
  for (const entry of confirmed) if (entry.date <= today) add(entry.date, entry.amount);
  const tomorrow = addDays(today, 1);
  // Overdue and unpaid items are assumed to be paid on the next day.
  for (const entry of planned) add(entry.date > today ? entry.date : tomorrow, entry.amount);
  for (const invoice of invoices) {
    const remaining = invoice.total - invoice.paid;
    if (!invoice.dueDate || remaining <= 0 || invoice.dueDate > last) continue;
    add(invoice.dueDate > today ? invoice.dueDate : tomorrow, -remaining);
  }

  const basis = bankBalance === undefined ? 'month' : 'bank';
  // Real balance at the end of each day up to today.
  const pastFlows = [...flowBy].filter(([date]) => date <= today).reduce((sum, [, amount]) => sum + amount, 0);
  let balance = basis === 'bank' ? bankBalance! - pastFlows : 0;
  const points: BalanceForecast['points'] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    balance += flowBy.get(date) ?? 0;
    points.push({ date, balance, projected: date > today });
  }
  const todayPoint = points.find(({ date }) => date === today) ?? points[0];
  const future = points.filter(({ projected }) => projected);
  const lowest = [todayPoint, ...future].reduce((min, point) => (point.balance < min.balance ? point : min));
  // First projected day below zero; when it is already negative today the screen says so instead.
  const negative = todayPoint.balance >= 0 ? future.find((point) => point.balance < 0) : undefined;
  return {
    basis,
    points,
    today: todayPoint.balance,
    end: points[points.length - 1].balance,
    lowest: { date: lowest.date, balance: lowest.balance },
    negativeOn: negative?.date ?? null,
  };
}
