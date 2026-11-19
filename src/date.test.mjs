import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceDates, invoiceMonthOf, shiftMonth } from './date.ts';
import { chargesInInvoice } from './recurring.ts';
import { createDemoService } from './backend/demo.ts';
import { currentMonth } from './date.ts';

test('invoice closes in the due month when the closing day comes first', () => {
  assert.deepEqual(invoiceDates('2026-03', 3, 10), { closingDate: '2026-03-03', dueDate: '2026-03-10', adjusted: false });
});

test('invoice closes the month before when the closing day is after the due day', () => {
  assert.deepEqual(invoiceDates('2026-03', 28, 5), { closingDate: '2026-02-28', dueDate: '2026-03-05', adjusted: false });
  assert.deepEqual(invoiceDates('2026-01', 31, 7).closingDate, '2025-12-31');
});

test('days past the end of a short month fall on its last day', () => {
  assert.deepEqual(invoiceDates('2026-03', 30, 31).closingDate, '2026-03-30');
  assert.deepEqual(invoiceDates('2026-04', 25, 31).dueDate, '2026-04-30');
  assert.deepEqual(invoiceDates('2026-03', 30, 2).closingDate, '2026-02-28');
});

test('cards without days have no dates, and month adjustments win', () => {
  assert.deepEqual(invoiceDates('2026-03', null, null), { closingDate: null, dueDate: null, adjusted: false });
  assert.deepEqual(
    invoiceDates('2026-03', 3, 10, { closingDate: null, dueDate: '2026-03-12' }),
    { closingDate: '2026-03-03', dueDate: '2026-03-12', adjusted: true },
  );
});

test('demo invoices follow the card days and keep a single month adjustment', async () => {
  const service = createDemoService();
  const month = currentMonth();
  const before = (await service.dashboard(month)).invoices[0];
  assert.equal(before.dueDate, `${month}-24`);
  assert.equal(before.closingDate, `${month}-17`);
  await service.mutate({ type: 'saveInvoiceDates', cardId: before.cardId, month, closingDate: null, dueDate: `${month}-26` });
  const adjusted = (await service.dashboard(month)).invoices[0];
  assert.equal(adjusted.dueDate, `${month}-26`);
  assert.equal(adjusted.adjusted, true);
  await assert.rejects(() => service.mutate({
    type: 'saveInvoiceDates', cardId: before.cardId, month, closingDate: `${month}-20`, dueDate: `${month}-10`,
  }));
  await service.mutate({ type: 'saveInvoiceDates', cardId: before.cardId, month, closingDate: null, dueDate: null });
  assert.equal((await service.dashboard(month)).invoices[0].dueDate, `${month}-24`);
});

test('a card charge after the closing day is billed in the next invoice', () => {
  assert.equal(invoiceMonthOf('2026-11-17', 17, 24), '2026-11');
  assert.equal(invoiceMonthOf('2026-11-18', 17, 24), '2026-12');
  assert.equal(invoiceMonthOf('2026-11-20', 28, 5), '2026-12');
  assert.equal(invoiceMonthOf('2026-11-29', 28, 5), '2027-01');
  assert.equal(invoiceMonthOf('2026-11-29', null, 5), null);
  const rule = { startMonth: '2026-10', day: 29 };
  // Closes 28, due 5: the October 29 charge is due in December, the November one in January.
  assert.deepEqual(chargesInInvoice(rule, { closingDay: 28, dueDay: 5 }, '2026-12'), ['2026-10-29']);
  assert.deepEqual(chargesInInvoice(rule, { closingDay: 28, dueDay: 5 }, '2026-11'), []);
  assert.deepEqual(chargesInInvoice({ ...rule, endMonth: '2026-10' }, { closingDay: 28, dueDay: 5 }, '2027-01'), []);
  // Without card days, the charge stays in its own month.
  assert.deepEqual(chargesInInvoice(rule, { closingDay: null, dueDay: null }, '2026-11'), ['2026-11-29']);
});

test('demo card subscriptions follow the closing day and move to the account when the card goes', async () => {
  const service = createDemoService();
  const month = currentMonth();
  const next = shiftMonth(month, 1);
  const invoiceTotal = async (period) => (await service.dashboard(period)).invoices.find(({ cardId }) => cardId === 'cartao')?.total ?? 0;
  const [thisBefore, nextBefore] = [await invoiceTotal(month), await invoiceTotal(next)];
  // The demo card closes on the 17th: a charge on the 20th belongs to next month's invoice.
  await service.mutate({ type: 'saveRecurrence', recurrence: {
    description: 'Jornal', amount: -3000, kind: 'expense', category: 'Assinaturas', startMonth: month, day: 20, cardId: 'cartao',
  } });
  const dashboard = await service.dashboard(month);
  assert.equal(dashboard.upcoming.find(({ description }) => description === 'Jornal')?.invoiceMonth, next);
  assert.equal(await invoiceTotal(month), thisBefore);
  // Only this month's charge (the 20th): next month's one goes to the invoice after that.
  assert.equal(await invoiceTotal(next), nextBefore + 3000);
  await service.mutate({ type: 'archiveCard', id: 'cartao' });
  const after = await service.dashboard(month);
  assert.ok(after.recurrences.every(({ cardId }) => !cardId));
  assert.equal(after.upcoming.find(({ description }) => description === 'Jornal')?.cardId, undefined);
});
