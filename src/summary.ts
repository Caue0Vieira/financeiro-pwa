import type { MonthlySummary, MonthlySummaryNumbers } from './contracts.ts';

/**
 * Monthly summary: every number is computed here, from the month's totals (the SQL function
 * monthly_summary_inputs in the Worker, the entries in the demo). Workers AI only writes a short
 * comment, and a comment with any digit is replaced by fallbackText, so no number comes from it.
 */

export interface SummaryInputs {
  /** YYYY-MM */
  month: string;
  income: number;
  expenses: number;
  categories: { category: string; amount: number }[];
  /** Spending by category in the month before. */
  previous: { category: string; amount: number }[];
  /** Monthly savings goal (0 when none). */
  goal: number;
  largest: { description: string; amount: number; date: string } | null;
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function buildSummary(input: SummaryInputs): MonthlySummaryNumbers {
  const totals = (rows: SummaryInputs['categories']) => {
    const map = new Map<string, { category: string; amount: number }>();
    for (const { category, amount } of rows) {
      const key = fold(category) || 'sem categoria';
      const current = map.get(key);
      map.set(key, { category: current?.category ?? (category.trim() || 'Sem categoria'), amount: (current?.amount ?? 0) + Number(amount) });
    }
    return map;
  };
  const now = totals(input.categories);
  const before = totals(input.previous);
  const growth = [...now].map(([key, { category, amount }]) => ({ category, amount, previous: before.get(key)?.amount ?? 0 }))
    .filter(({ amount, previous }) => amount - previous >= 100)
    .sort((a, b) => b.amount - b.previous - (a.amount - a.previous) || a.category.localeCompare(b.category, 'pt-BR'))
    .slice(0, 3);
  const income = Number(input.income);
  const expenses = Number(input.expenses);
  const balance = income - expenses;
  const goal = Math.max(0, Number(input.goal) || 0);
  return {
    income,
    expenses,
    balance,
    growth,
    goal,
    goalMet: goal > 0 ? balance >= goal : null,
    largest: input.largest && Number(input.largest.amount) > 0
      ? { description: input.largest.description, amount: Number(input.largest.amount), date: String(input.largest.date).slice(0, 10) }
      : null,
  };
}

/** A monthly_summaries row as the app sees it. */
export const summaryFrom = (row: { month: string; numbers: unknown; text: string; dismissed_at?: string | null }): MonthlySummary => ({
  ...(row.numbers as MonthlySummaryNumbers),
  month: String(row.month).slice(0, 7),
  text: row.text,
  dismissed: Boolean(row.dismissed_at),
});

/** "outubro de 2026" */
export const monthLabel = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15))
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "outubro" */
export const monthOnly = (month: string) => monthLabel(month).replace(/ de \d{4}$/, '');

/** Comment written by the app itself, used without AI or when the AI answer is not usable. */
export function fallbackText(numbers: MonthlySummaryNumbers, month: string) {
  const name = monthOnly(month);
  const parts = [
    numbers.balance >= 0
      ? `Você fechou ${name} com as entradas cobrindo as saídas.`
      : `Em ${name} as saídas passaram das entradas.`,
  ];
  if (numbers.growth.length) parts.push(`${numbers.growth[0].category} foi a categoria que mais cresceu em relação ao mês anterior.`);
  if (numbers.goalMet === true) parts.push('A meta de economia do mês foi batida.');
  if (numbers.goalMet === false) parts.push('A meta de economia ficou para o próximo mês.');
  return parts.join(' ');
}

/** Messages for Workers AI: the numbers go as context, the answer must not repeat them. */
export function summaryPrompt(numbers: MonthlySummaryNumbers, month: string) {
  const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
  const lines = [
    `Mês: ${monthLabel(month)}.`,
    `Entradas: ${brl(numbers.income)}. Saídas: ${brl(numbers.expenses)}. Saldo: ${brl(numbers.balance)}.`,
    numbers.growth.length
      ? `Categorias que mais cresceram: ${numbers.growth.map((item) => `${item.category} (de ${brl(item.previous)} para ${brl(item.amount)})`).join('; ')}.`
      : 'Nenhuma categoria cresceu em relação ao mês anterior.',
    numbers.goalMet === null ? 'Sem meta mensal de economia.' : `Meta de economia ${numbers.goalMet ? 'batida' : 'não batida'}.`,
    numbers.largest ? `Maior gasto: ${numbers.largest.description}.` : '',
  ].filter(Boolean);
  return [
    {
      role: 'system',
      content: [
        'Você escreve o comentário do resumo mensal de um app de finanças pessoais, em português do Brasil.',
        'Escreva 2 ou 3 frases curtas, em tom amigável e prático, comentando o mês e sugerindo um cuidado para o próximo.',
        'NÃO escreva nenhum número, valor, porcentagem ou data: o app já mostra os números ao lado do texto.',
        'Não recomende investimentos específicos. Responda só com o texto, sem títulos nem listas.',
      ].join(' '),
    },
    { role: 'user', content: lines.join('\n') },
  ];
}

/** The AI comment if it is usable (short, no digits); otherwise null. */
export function usableComment(answer: unknown) {
  const text = typeof answer === 'string' ? answer.replace(/\s+/g, ' ').trim() : '';
  if (text.length < 20 || text.length > 700 || /\d/.test(text)) return null;
  return text;
}
