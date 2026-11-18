import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceAlertMonths, selectInvoiceAlerts } from "./invoiceAlerts.ts";

test("invoice reminders carry balances across the month boundary", () => {
  const today = "2026-11-30";
  assert.deepEqual(invoiceAlertMonths(today), ["2026-11", "2026-12"]);
  assert.deepEqual(invoiceAlertMonths("2026-12-01"), ["2026-11", "2026-12"]);

  const invoice = (cardId, dueDate, total, paid = 0) => ({
    cardId, month: dueDate?.slice(0, 7) ?? "2026-11", dueDate, total, paid,
  });
  const alerts = selectInvoiceAlerts([
    invoice("last-day", "2026-12-07", 2000),
    invoice("after-window", "2026-12-08", 2000),
    invoice("partial-payment", "2026-11-29", 10000, 3500),
    invoice("already-paid", "2026-11-30", 3000, 3000),
    invoice("no-due-day", null, 3000),
    invoice("older", "2026-11-22", 4000),
  ], today);

  assert.deepEqual(alerts, [
    { cardId: "partial-payment", month: "2026-11", dueDate: "2026-11-29", remaining: 6500 },
    { cardId: "last-day", month: "2026-12", dueDate: "2026-12-07", remaining: 2000 },
  ]);
});
