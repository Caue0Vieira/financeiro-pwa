import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoService } from './demo.ts';
import { currentMonth, shiftMonth } from '../date.ts';

test('monthly budgets are independent of the savings target and of other months', async () => {
  const service = createDemoService();
  const month = currentMonth();
  const before = await service.dashboard(month);
  await service.mutate({ type: 'saveBudget', month, amount: 320000 });
  const after = await service.dashboard(month);
  assert.equal(after.budget, 320000);
  assert.equal(after.goal, before.goal);
  assert.equal((await service.dashboard(shiftMonth(month, -1))).budget, 0);
});

test('personal goals and their deposits are tracked separately', async () => {
  const service = createDemoService();
  const month = currentMonth();
  const before = await service.dashboard(month);
  await service.mutate({ type: 'saveTarget', target: { name: 'Viagem', amount: 90000 } });
  const created = (await service.dashboard(month)).targets.find(({ name }) => name === 'Viagem');
  await service.mutate({ type: 'contributeTarget', id: created.id, amount: 25000 });
  const after = await service.dashboard(month);
  assert.equal(after.targets.find(({ id }) => id === created.id).saved, 25000);
  assert.equal(after.saved, before.saved);
});

test('spending totals include confirmed expenses and refunds for the selected period', async () => {
  const service = createDemoService();
  const month = currentMonth();
  const totals = await service.analysis(`${month}-15`, 'month');
  assert.equal(totals.total, (await service.dashboard(month)).expenses);
  assert.equal(totals.points.reduce((sum, point) => sum + point.amount, 0), totals.total);
  assert.equal((await service.analysis(`${month}-15`, 'week')).points.length, 7);
  assert.equal((await service.analysis(`${month}-15`, 'year')).points.length, 12);
});
