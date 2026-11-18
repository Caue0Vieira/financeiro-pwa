import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceDates } from './date.ts';
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
