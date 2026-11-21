import type { DetectedSubscription, PushPreferences } from './contracts.ts';
import { addDays, invoiceDates, shiftMonth } from './date.ts';
import { chargeDate } from './recurring.ts';

/**
 * Push notices: what each kind means, when it is due and the text it shows. Pure functions
 * shared by the Worker (which sends them from the cron) and the tests; no I/O here.
 */

export type NoticeKind = 'bill_due' | 'invoice_closing' | 'large_expense' | 'budget' | 'monthly_summary' | 'negative_balance' | 'subscription';

export const defaultPreferences: PushPreferences = {
  billDue: true,
  invoiceClosing: true,
  largeExpense: true,
  largeExpenseMin: 50000,
  budget: true,
  monthlySummary: true,
  negativeBalance: true,
  subscriptions: true,
};

/** Fills what a stored (or older) preferences object lacks; ignores anything unexpected. */
export function normalizePreferences(value: unknown): PushPreferences {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof PushPreferences) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (defaultPreferences[key] as boolean);
  const min = Math.round(Number(raw.largeExpenseMin));
  return {
    billDue: flag('billDue'),
    invoiceClosing: flag('invoiceClosing'),
    largeExpense: flag('largeExpense'),
    largeExpenseMin: min >= 100 && min <= 100_000_000 ? min : defaultPreferences.largeExpenseMin,
    budget: flag('budget'),
    monthlySummary: flag('monthlySummary'),
    negativeBalance: flag('negativeBalance'),
    subscriptions: flag('subscriptions'),
  };
}

/** The preference switch of each kind. */
export const preferenceOf: Record<NoticeKind, keyof PushPreferences> = {
  bill_due: 'billDue',
  invoice_closing: 'invoiceClosing',
  large_expense: 'largeExpense',
  budget: 'budget',
  monthly_summary: 'monthlySummary',
  negative_balance: 'negativeBalance',
  subscription: 'subscriptions',
};

/** Hours (São Paulo) each kind may be sent; outside them it waits for the next run. */
const sendingHours: Record<NoticeKind, [number, number]> = {
  bill_due: [9, 21],
  invoice_closing: [9, 21],
  large_expense: [7, 22],
  budget: [8, 22],
  monthly_summary: [9, 21],
  negative_balance: [9, 21],
  subscription: [9, 21],
};
export const dueKinds = (hour: number) =>
  (Object.keys(sendingHours) as NoticeKind[]).filter((kind) => hour >= sendingHours[kind][0] && hour <= sendingHours[kind][1]);

/** One thing to tell the user. `ref` identifies it in notification_log so it is sent once. */
export interface NoticeItem {
  kind: NoticeKind;
  ref: string;
  label: string;
  /** Cents, positive. */
  amount: number;
  date?: string;
  /** budget: spent and limit; 80 or 100. */
  limit?: number;
  level?: 80 | 100;
}

/** What the service worker shows. `url` opens the right screen (see FinanceApp). */
export interface PushMessage { title: string; body: string; url: string; tag: string }
export interface Notice extends PushMessage { kind: NoticeKind; refs: string[] }

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number) => currency.format(cents / 100);
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const list = (items: string[]) => new Intl.ListFormat('pt-BR').format(items);
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const screenUrl = (page: string) => `/?abrir=${page}`;

/** Bills (planned, not on a card) and recurring bills due tomorrow that were not recorded yet. */
export function billsDueTomorrow(
  today: string,
  planned: { id: string; description: string; amount: number; date: string }[],
  rules: { id: string; description: string; amount: number; day: number; startMonth: string; endMonth?: string }[],
  recorded: Set<string>,
): NoticeItem[] {
  const tomorrow = addDays(today, 1);
  const month = tomorrow.slice(0, 7);
  const items: NoticeItem[] = planned
    .filter((entry) => entry.date === tomorrow && entry.amount < 0)
    .map((entry) => ({ kind: 'bill_due', ref: entry.id, label: entry.description, amount: -entry.amount, date: tomorrow }));
  for (const rule of rules) {
    if (rule.amount >= 0 || chargeDate(rule, month) !== tomorrow || recorded.has(`${rule.id}:${month}`)) continue;
    items.push({ kind: 'bill_due', ref: `${rule.id}:${tomorrow}`, label: rule.description, amount: -rule.amount, date: tomorrow });
  }
  return items;
}

/** Card invoices that close in exactly two days (by the card's days or that month's adjustment). */
export function invoicesClosing(
  today: string,
  cards: { id: string; name: string; closingDay: number | null; dueDay: number | null; archived?: boolean; billBalance?: number }[],
  overrides: { cardId: string; month: string; closingDate: string | null; dueDate: string | null }[],
): NoticeItem[] {
  const target = addDays(today, 2);
  const items: NoticeItem[] = [];
  for (const card of cards) {
    if (card.archived || card.closingDay === null) continue;
    // The invoice that closes on `target` is due that month or the next.
    for (const month of [target.slice(0, 7), shiftMonth(target.slice(0, 7), 1)]) {
      const override = overrides.find((item) => item.cardId === card.id && item.month === month);
      const { closingDate } = invoiceDates(month, card.closingDay, card.dueDay, override);
      if (closingDate !== target) continue;
      items.push({
        kind: 'invoice_closing', ref: `${card.id}:${target}`, label: card.name,
        amount: Math.max(0, card.billBalance ?? 0), date: target,
      });
      break;
    }
  }
  return items;
}

/** Expenses that came from Open Finance at or above the minimum (cents). */
export function largeExpenses(rows: { id: string; description: string; amount: number; date: string }[], min: number): NoticeItem[] {
  return rows
    .filter((row) => -row.amount >= min)
    .map((row) => ({ kind: 'large_expense', ref: row.id, label: row.description, amount: -row.amount, date: row.date }));
}

/** Categories (and the month's overall budget) at 80% or more of their limit. */
export function budgetAlerts(
  month: string,
  spending: { category: string; spent: number }[],
  limits: { category: string; amount: number }[],
  monthlyBudget = 0,
): NoticeItem[] {
  const spent = new Map<string, number>();
  for (const row of spending) spent.set(fold(row.category), (spent.get(fold(row.category)) ?? 0) + row.spent);
  const checks = limits.map(({ category, amount }) => ({ key: category, label: category, limit: amount, spent: spent.get(fold(category)) ?? 0 }));
  if (monthlyBudget > 0) {
    const total = [...spent.values()].reduce((sum, value) => sum + value, 0);
    checks.push({ key: 'mes', label: 'Orçamento do mês', limit: monthlyBudget, spent: total });
  }
  const items: NoticeItem[] = [];
  for (const check of checks) {
    if (check.limit <= 0 || check.spent < check.limit * 0.8) continue;
    for (const level of check.spent >= check.limit ? [80, 100] as const : [80] as const) {
      items.push({
        kind: 'budget', ref: `${fold(check.key)}:${month}:${level}`, label: check.label,
        amount: check.spent, limit: check.limit, level,
      });
    }
  }
  return items;
}

/** Whether a device with these preferences wants the item. */
export function wants(preferences: PushPreferences, item: NoticeItem) {
  if (!preferences[preferenceOf[item.kind]]) return false;
  return item.kind !== 'large_expense' || item.amount >= preferences.largeExpenseMin;
}

/**
 * Groups the items into the notifications to show, one per kind (a category at 100% hides its
 * 80% one but both refs are logged). Several bills due tomorrow become a single notification.
 */
export function composeNotices(items: NoticeItem[]): Notice[] {
  const notices: Notice[] = [];
  const byKind = (kind: NoticeKind) => items.filter((item) => item.kind === kind);

  const bills = byKind('bill_due');
  if (bills.length) {
    const total = bills.reduce((sum, item) => sum + item.amount, 0);
    notices.push({
      kind: 'bill_due', refs: bills.map(({ ref }) => ref), tag: 'contas-amanha', url: screenUrl('commitments'),
      title: bills.length === 1 ? 'Conta vence amanhã' : `${bills.length} contas vencem amanhã`,
      body: bills.length === 1
        ? `${bills[0].label}: ${money(total)}.`
        : `${list(bills.slice(0, 3).map(({ label }) => label))}${bills.length > 3 ? ' e outras' : ''}: ${money(total)} no total.`,
    });
  }

  const invoices = byKind('invoice_closing');
  if (invoices.length) {
    const [first] = invoices;
    const amount = first.amount > 0 ? ` Até agora: ${money(first.amount)}.` : '';
    notices.push({
      kind: 'invoice_closing', refs: invoices.map(({ ref }) => ref), tag: 'fatura-fechando', url: screenUrl('commitments'),
      title: invoices.length === 1 ? 'Fatura fecha em 2 dias' : `${invoices.length} faturas fecham em 2 dias`,
      body: invoices.length === 1
        ? `A fatura do ${first.label} fecha em ${dayMonth(first.date!)}.${amount}`
        : `${list(invoices.map(({ label }) => label))} fecham em ${dayMonth(first.date!)}.`,
    });
  }

  const expenses = byKind('large_expense');
  if (expenses.length) {
    const [first] = expenses;
    notices.push({
      kind: 'large_expense', refs: expenses.map(({ ref }) => ref), tag: 'gasto-alto', url: screenUrl('activity'),
      title: expenses.length === 1 ? `Gasto de ${money(first.amount)}` : `${expenses.length} gastos altos`,
      body: expenses.length === 1
        ? `${first.label}, em ${dayMonth(first.date!)}.`
        : `${list(expenses.slice(0, 3).map(({ label, amount }) => `${label} (${money(amount)})`))}${expenses.length > 3 ? ' e outros' : ''}.`,
    });
  }

  const budgets = byKind('budget');
  // Highest level per limit; the lower one only adds its ref.
  const shown = budgets.filter((item) => !(item.level === 80 && budgets.some((other) => other.label === item.label && other.level === 100)));
  if (shown.length) {
    const [first] = shown;
    const over = shown.filter(({ level }) => level === 100);
    notices.push({
      kind: 'budget', refs: budgets.map(({ ref }) => ref), tag: 'orcamento', url: screenUrl('analytics'),
      title: shown.length === 1
        ? first.level === 100 ? `${first.label}: limite ultrapassado` : `${first.label}: 80% do limite`
        : over.length
          ? `${over.length} ${over.length === 1 ? 'limite ultrapassado' : 'limites ultrapassados'}`
          : `${shown.length} limites chegaram a 80%`,
      body: shown.length === 1
        ? `${money(first.amount)} de ${money(first.limit!)} no mês.`
        : list(shown.map(({ label, amount, limit }) => `${label} ${Math.round((amount / limit!) * 100)}%`)) + '.',
    });
  }
  const summaries = byKind('monthly_summary');
  if (summaries.length) {
    const [latest] = summaries;
    notices.push({
      kind: 'monthly_summary', refs: summaries.map(({ ref }) => ref), tag: 'resumo-mensal', url: screenUrl('home'),
      title: `Seu resumo de ${latest.label} chegou`,
      body: 'Veja entradas, saídas, o que mais cresceu e se a meta foi batida.',
    });
  }
  const negative = byKind('negative_balance');
  if (negative.length) {
    const [first] = negative;
    notices.push({
      kind: 'negative_balance', refs: negative.map(({ ref }) => ref), tag: 'saldo-negativo', url: screenUrl('home'),
      title: 'Seu saldo pode ficar negativo',
      body: `Pela previsão, o saldo fica abaixo de zero no dia ${Number(first.date!.slice(8, 10))} e chega a ${money(-first.amount)}. Veja o que vence até lá.`,
    });
  }
  const subscriptions = byKind('subscription');
  if (subscriptions.length) {
    const fresh = subscriptions.filter(({ ref }) => ref.startsWith('nova:'));
    const pricier = subscriptions.filter(({ ref }) => ref.startsWith('preco:'));
    const [first] = subscriptions;
    let title: string;
    let body: string;
    if (subscriptions.length > 1) {
      if (!pricier.length) title = `${fresh.length} assinaturas novas`;
      else if (!fresh.length) title = `${pricier.length} assinaturas mais caras`;
      else title = 'Mudanças nas assinaturas';
      body = `${list(subscriptions.slice(0, 3).map(({ label }) => label))}. Confira em Assinaturas.`;
    } else if (fresh.length) {
      title = `Nova assinatura: ${first.label}`;
      body = `Cobrança de ${money(first.amount)}. Confirme ou ignore em Assinaturas.`;
    } else {
      title = `${first.label} ficou mais cara`;
      body = `De ${money(first.limit!)} para ${money(first.amount)}.`;
    }
    notices.push({ kind: 'subscription', refs: subscriptions.map(({ ref }) => ref), tag: 'assinaturas', url: screenUrl('subscriptions'), title, body });
  }
  return notices;
}

/** New subscriptions not reviewed yet and price increases charged in the last 10 days. */
export function subscriptionItems(list: DetectedSubscription[], today: string): NoticeItem[] {
  const items: NoticeItem[] = [];
  for (const item of list) {
    if (item.status === 'ignored' || item.status === 'cancelled') continue;
    if (item.isNew) items.push({ kind: 'subscription', ref: `nova:${item.key}`, label: item.name, amount: item.amount });
    else if (item.priceChange > 0 && item.lastDate >= addDays(today, -10)) {
      items.push({ kind: 'subscription', ref: `preco:${item.key}:${item.lastDate}`, label: item.name, amount: item.amount, limit: item.previousAmount });
    }
  }
  return items;
}

/** Push services browsers use; the Worker only posts to these (no arbitrary URLs). */
export function knownPushService(endpoint: string) {
  try {
    const { protocol, hostname } = new URL(endpoint);
    return protocol === 'https:' && /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/.test(hostname);
  } catch {
    return false;
  }
}
