import type { Invoice } from "../contracts.ts";
import { addDays } from "../date.ts";

const leadDays = 7;

export function invoiceAlertMonths(today: string) {
  const first = addDays(today, -leadDays).slice(0, 7);
  const last = addDays(today, leadDays).slice(0, 7);
  return first === last ? [first] : [first, last];
}

export function selectInvoiceAlerts(invoices: Invoice[], today: string) {
  const first = addDays(today, -leadDays);
  const last = addDays(today, leadDays);
  const alerts = [];
  for (const { cardId, month, dueDate, total, paid } of invoices) {
    const remaining = total - paid;
    if (!dueDate || dueDate < first || dueDate > last || remaining <= 0) continue;
    alerts.push({ cardId, month, dueDate, remaining });
  }
  return alerts.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type InvoiceAlert = ReturnType<typeof selectInvoiceAlerts>[number];
