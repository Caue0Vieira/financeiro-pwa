import type { AnalysisPeriod, SpendingAnalysis } from '../contracts.ts';
import { addDays, shiftMonth } from '../date.ts';

export function spendingWindow(date: string, period: AnalysisPeriod) {
  const month = date.slice(0, 7);
  const year = Number(date.slice(0, 4));
  if (period === 'week') {
    return { previous: addDays(date, -13), start: addDays(date, -6), end: addDays(date, 1) };
  }
  if (period === 'year') {
    return { previous: `${year - 1}-01-01`, start: `${year}-01-01`, end: `${year + 1}-01-01` };
  }
  return { previous: `${shiftMonth(month, -1)}-01`, start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

export function summarizeSpending(
  rows: { date: string; category: string; amount: number }[],
  window: ReturnType<typeof spendingWindow>,
  period: AnalysisPeriod,
): SpendingAnalysis {
  const { start, end } = window;
  const points: SpendingAnalysis['points'] = [];
  const step = period === 'week' ? 1 : 7;
  const next = (date: string) => period === 'year' ? shiftMonth(date.slice(0, 7), 1) + '-01' : addDays(date, step);
  for (let date = start; date < end; date = next(date)) points.push({ date, amount: 0 });

  let previous = 0;
  let total = 0;
  const categoryTotals = new Map<string, number>();
  for (const row of rows) {
    if (row.date < start) {
      previous += row.amount;
      continue;
    }
    total += row.amount;
    const point = points.findLast(({ date }) => date <= row.date);
    if (point) point.amount += row.amount;
    const category = row.category.trim() || 'Sem categoria';
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + row.amount);
  }
  const categories = [...categoryTotals].map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  return { range: { start, end: addDays(end, -1) }, total, previous, points, categories };
}
