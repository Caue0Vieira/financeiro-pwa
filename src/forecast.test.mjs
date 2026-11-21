import assert from "node:assert/strict";
import { test } from "node:test";
import { projectBalance } from "./forecast.ts";

const today = "2026-11-21";
const entry = (date, amount, status = "confirmed", cardId) => ({ date, amount, status, cardId });
const at = (forecast, date) => forecast.points.find((point) => point.date === date);

const entries = [
  entry("2026-11-05", 600000),               // salary
  entry("2026-11-07", -188000),              // rent
  entry("2026-11-10", -50000, "confirmed", "nu"), // card purchase: paid through the invoice
  entry("2026-11-20", -30000, "planned"),    // overdue bill: assumed paid tomorrow
  entry("2026-11-26", -11990, "planned"),    // recurring bill
  entry("2026-11-28", 150000, "planned"),    // freela
  entry("2026-12-01", -99999, "planned"),    // next month: out of the window
];
const invoices = [{ dueDate: "2026-11-24", total: 300000, paid: 100000 }, { dueDate: "2026-11-10", total: 5000, paid: 5000 }];

test("from the bank balance: real back to day 1, projected to the end of the month", () => {
  const forecast = projectBalance({ today, entries, invoices, bankBalance: 400000 });
  assert.equal(forecast.basis, "bank");
  assert.equal(forecast.points.length, 30);
  assert.equal(forecast.today, 400000);
  // Before the salary and the rent of this month, the account had what is left after undoing them.
  assert.equal(at(forecast, "2026-11-01").balance, 400000 - 600000 + 188000);
  assert.equal(at(forecast, "2026-11-21").projected, false);
  assert.equal(at(forecast, "2026-11-22").balance, 370000);
  assert.equal(at(forecast, "2026-11-24").balance, 170000);
  assert.equal(at(forecast, "2026-11-26").balance, 158010);
  assert.equal(forecast.end, 308010);
  assert.equal(forecast.negativeOn, null);
  assert.deepEqual(forecast.lowest, { date: "2026-11-26", balance: 158010 });
});

test("the first projected day below zero is the alert", () => {
  const forecast = projectBalance({ today, entries, invoices, bankBalance: 220000 });
  assert.equal(forecast.negativeOn, "2026-11-24");
  assert.deepEqual(forecast.lowest, { date: "2026-11-26", balance: -21990 });
  const already = projectBalance({ today, entries, invoices, bankBalance: -1000 });
  assert.equal(already.negativeOn, null);
  assert.equal(already.today, -1000);
});

test("without Open Finance it is the month's own cash flow from zero", () => {
  const forecast = projectBalance({ today, entries, invoices });
  assert.equal(forecast.basis, "month");
  assert.equal(at(forecast, "2026-11-04").balance, 0);
  assert.equal(forecast.today, 412000);
  assert.equal(forecast.end, 412000 - 30000 - 200000 - 11990 + 150000);
});

test("last day of the month has nothing left to project", () => {
  const forecast = projectBalance({ today: "2026-11-30", entries: [], invoices: [], bankBalance: 1 });
  assert.ok(forecast.points.every(({ projected }) => !projected));
  assert.equal(forecast.end, 1);
});
