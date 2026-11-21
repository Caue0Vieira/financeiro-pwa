import type { Account, Assistant, Card, Coverage, Dashboard, Entry, FinanceService, Investment, Invoice, MonthlySummary, Profile, PushNotifications, PushPreferences, Recurrence, SavingsTarget, Valuation } from '../contracts';
import { normalizePreferences } from '../notices.ts';
import { buildSummary, fallbackText } from '../summary.ts';
import { addDays, currentMonth, dateInMonth, invoiceDates, shiftMonth, todayInSaoPaulo } from '../date.ts';
import { spendingWindow, summarizeSpending } from './spending.ts';
import { chargeDate, chargeInvoiceMonth, chargesInInvoice } from '../recurring.ts';

export function createDemoService(): FinanceService {
  const month = currentMonth();
  const accounts: Account[] = [{ id: 'conta', name: 'Banco Inter' }];
  const cards: Card[] = [
    { id: 'cartao', name: 'Cartão principal', accountId: 'conta', dueDay: 24, closingDay: 17, creditLimit: 800000, availableLimit: 512340, billBalance: 287660 },
  ];
  /** Per-month invoice date adjustments, keyed by `${cardId}:${month}`. */
  const invoiceDateOverrides = new Map<string, { closingDate: string | null; dueDate: string | null }>();
  const investments: Investment[] = [
    { id: 'acoes', institution: 'Corretora Pontal', name: 'Ações', contributed: 218025, value: 245060, updatedOn: todayInSaoPaulo() },
    { id: 'fundo', institution: 'Corretora Pontal', name: 'Fundos de investimento', contributed: 113197, value: 123045, updatedOn: todayInSaoPaulo() },
    { id: 'cripto', institution: 'Corretora Pontal', name: 'Criptomoedas', contributed: 55481, value: 63970, updatedOn: todayInSaoPaulo() },
  ];
  const recurrences: Recurrence[] = [
    { id: 'internet', description: 'Internet residencial', amount: -11990, kind: 'expense', category: 'Moradia', startMonth: month, day: 26 },
    { id: 'streaming', description: 'Streaming', amount: -4490, kind: 'expense', category: 'Assinaturas', startMonth: month, day: 28 },
    { id: 'musica', description: 'Spotify', amount: -2190, kind: 'expense', category: 'Assinaturas', startMonth: month, day: 12, cardId: 'cartao' },
  ];
  const profile: Profile = { name: 'Ayesha Khan' };
  const goals = new Map<string, number>([[month, 90000], [shiftMonth(month, -1), 90000]]);
  /** Months whose summary card was dismissed. */
  const dismissedSummaries = new Set<string>();
  const budgets = new Map<string, number>([[month, 200000]]);
  /** Category limits (same every month), by category name. */
  const categoryBudgets = new Map<string, number>([['Alimentação', 60000], ['Assinaturas', 20000]]);
  const targets: SavingsTarget[] = [
    { id: 'emergencia', name: 'Reserva de emergência', amount: 300000, saved: 120000 },
    { id: 'ferias', name: 'Viagem de férias', amount: 250000, saved: 85000 },
    { id: 'notebook', name: 'Notebook novo', amount: 150000, saved: 60000 },
    { id: 'casa', name: 'Entrada da casa', amount: 2000000, saved: 500000 },
  ];
  const values = new Map<string, Valuation[]>(investments.map((item) => [item.id,
    Array.from({ length: 73 }, (_, index) => ({
      date: addDays(todayInSaoPaulo(), (index - 72) * 3),
      value: Math.round(item.value * (0.78 + index * 0.22 / 72 + Math.sin(index * Math.PI / 4) * 0.017)),
    })),
  ]));

  function portfolioHistory() {
    const series = [...values.values()].map((points) => [...points].sort((a, b) => a.date.localeCompare(b.date)));
    const days = [...new Set(series.flatMap((points) => points.map(({ date }) => date)))].sort();
    return days.map((date) => ({
      date,
      value: series.reduce((sum, points) => sum + (points.findLast((point) => point.date <= date)?.value ?? 0), 0),
    }));
  }
  const imported = new Set<string>();
  const externalIds = new Set<string>();
  const coverage: Coverage[] = [];
  const allocations: { paymentId: string; cardId: string; month: string; amount: number }[] = [];
  const entries: Entry[] = [];

  const seed = (date: string, description: string, amount: number, kind: Entry['kind'], category: string, rest: Partial<Entry> = {}) => {
    entries.push({ id: crypto.randomUUID(), date, description, amount, kind, category, source: 'manual', status: 'confirmed', accountId: 'conta', ...rest });
  };

  for (let index = -5; index < 0; index++) {
    const period = shiftMonth(month, index);
    seed(dateInMonth(period, 5), 'Salário', 625000 + index * 7000, 'income', 'Salário');
    seed(dateInMonth(period, 7), 'Aluguel', -188000, 'expense', 'Moradia');
    seed(dateInMonth(period, 14), 'Mercado', -42180 - Math.abs(index * 3600), 'expense', 'Alimentação');
    seed(dateInMonth(period, 9), 'Transporte', -17850 + index * 2500, 'expense', 'Transporte');
    seed(dateInMonth(period, 18), 'Outras despesas', -71000 + index * 5300, 'expense', 'Outros');
  }
  const today = todayInSaoPaulo();
  const recentDate = (days: number) => {
    const date = addDays(today, -days);
    return date.startsWith(month) ? date : dateInMonth(month, 1);
  };
  seed(today, 'Mercado', -4520, 'expense', 'Alimentação');
  seed(today, 'Salário', 120000, 'income', 'Salário');
  seed(recentDate(1), 'Netflix', -1599, 'expense', 'Assinaturas');
  seed(recentDate(1), 'Cafeteria', -450, 'expense', 'Alimentação');
  seed(recentDate(2), 'Starbucks', -575, 'expense', 'Alimentação');
  seed(recentDate(2), 'Uber', -1240, 'expense', 'Transporte');
  seed(recentDate(3), 'Walmart', -6832, 'expense', 'Compras');
  seed(recentDate(4), 'Farmácia', -2450, 'expense', 'Saúde');
  seed(recentDate(5), 'Claude', -9900, 'expense', 'Assinaturas');
  seed(recentDate(6), 'Gemini', -9699, 'expense', 'Assinaturas');
  seed(recentDate(7), 'Prime Video', -1990, 'expense', 'Assinaturas');
  seed(dateInMonth(month, 22), 'Energia elétrica', -16340, 'expense', 'Moradia', { status: 'planned' });
  seed(dateInMonth(month, 24), 'Fone de ouvido', -9990, 'expense', 'Compras', {
    source: 'installment', accountId: undefined, cardId: 'cartao', invoiceMonth: month,
    installmentNumber: 2, installmentCount: 4, status: 'planned',
  });
  seed(dateInMonth(month, 24), 'Geladeira', -38990, 'expense', 'Casa', {
    source: 'installment', accountId: undefined, cardId: 'cartao', invoiceMonth: month,
    installmentNumber: 7, installmentCount: 10, status: 'planned',
  });

  const recorded = (ruleId: string, month: string) =>
    entries.some((entry) => entry.recurrenceId === ruleId && entry.date.slice(0, 7) === month);
  const ruleCharge = (rule: Recurrence, date: string): Entry => ({
    id: `previsto:${rule.id}:${date.slice(0, 7)}`, date, description: rule.description,
    recurrenceId: rule.id, category: rule.category, amount: rule.amount, kind: rule.kind, status: 'planned', source: 'recurrence',
    // Charged on a card: billed in the invoice its date falls into, by the card's closing day.
    ...(rule.cardId
      ? { cardId: rule.cardId, invoiceMonth: chargeInvoiceMonth(date, cards.find(({ id }) => id === rule.cardId)) }
      : {}),
  });

  function items(period: string) {
    const result = entries.filter((entry) => (entry.invoiceMonth ?? entry.date.slice(0, 7)) === period);
    for (const rule of recurrences) {
      const date = chargeDate(rule, period);
      if (date && !recorded(rule.id, period)) result.push(ruleCharge(rule, date));
    }
    return result.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  /** What a card's invoice due in `period` holds, including recurring charges from earlier months. */
  function invoiceItems(period: string, card: Card) {
    const stored = entries.filter((entry) => entry.cardId === card.id && (entry.invoiceMonth ?? entry.date.slice(0, 7)) === period);
    const charges = recurrences
      .filter((rule) => rule.cardId === card.id)
      .flatMap((rule) => chargesInInvoice(rule, card, period)
        .filter((date) => !recorded(rule.id, date.slice(0, 7)))
        .map((date) => ruleCharge(rule, date)));
    return [...stored, ...charges];
  }

  function invoices(period: string): Invoice[] {
    return cards.map((card) => ({
      cardId: card.id,
      month: period,
      ...invoiceDates(period, card.closingDay, card.dueDay, invoiceDateOverrides.get(`${card.id}:${period}`)),
      total: invoiceItems(period, card).reduce((sum, entry) => sum - entry.amount, 0),
      paid: allocations.filter((item) => item.cardId === card.id && item.month === period).reduce((sum, item) => sum + item.amount, 0),
    })).filter((invoice) => invoice.total !== 0 || invoice.paid !== 0);
  }

  function monthly(period: string) {
    const all = items(period);
    const confirmed = all.filter((entry) => entry.status === 'confirmed');
    const income = all.filter((entry) => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0);
    const expenses = confirmed.filter(isExpense).reduce((sum, entry) => sum - entry.amount, 0);
    return { all, confirmed, income, expenses };
  }

  /** Same numbers the Worker computes; the comment is the app's own (no AI in the demo). */
  function summaryOf(period: string): MonthlySummary | null {
    const confirmed = (target: string) => entries.filter((entry) => entry.status === 'confirmed' && entry.date.slice(0, 7) === target);
    const current = confirmed(period);
    if (!current.length) return null;
    const spending = (list: Entry[]) => list.filter(isExpense).map(({ category, amount }) => ({ category, amount: -amount }));
    const [largest] = current.filter((entry) => entry.kind === 'expense').sort((a, b) => a.amount - b.amount);
    const numbers = buildSummary({
      month: period,
      income: current.filter((entry) => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0),
      expenses: -current.filter(isExpense).reduce((sum, entry) => sum + entry.amount, 0),
      categories: spending(current),
      previous: spending(confirmed(shiftMonth(period, -1))),
      goal: goals.get(period) ?? 0,
      largest: largest ? { description: largest.description, amount: -largest.amount, date: largest.date } : null,
    });
    return { ...numbers, month: period, text: fallbackText(numbers, period), dismissed: dismissedSummaries.has(period) };
  }
  const lastMonth = () => shiftMonth(currentMonth(), -1);

  return {
    async session() { return { email: 'demo@example.test' }; },
    onSessionChange() { return () => {}; },
    async signIn() {},
    async signOut() {
      if (profile.avatarUrl) URL.revokeObjectURL(profile.avatarUrl);
    },
    async dashboard(period): Promise<Dashboard> {
      const { all, confirmed, income, expenses } = monthly(period);
      const cash = confirmed.filter((entry) => !entry.cardId);
      const upcoming = all.filter((entry) => entry.status === 'planned').sort((a, b) => a.date.localeCompare(b.date));
      const categoryTotals = new Map<string, number>();
      for (const entry of confirmed.filter(isExpense)) {
        categoryTotals.set(entry.category, (categoryTotals.get(entry.category) ?? 0) - entry.amount);
      }
      const monthInvoices = invoices(period);
      return {
        month: period,
        profile: { ...profile },
        received: confirmed.filter((entry) => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0),
        expectedIncome: income,
        expenses,
        toPay: upcoming.filter((entry) => !entry.cardId && entry.kind === 'expense').reduce((sum, entry) => sum - entry.amount, 0)
          + monthInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0),
        projectedSurplus: income + all.filter(isExpense).reduce((sum, entry) => sum + entry.amount, 0),
        goal: goals.get(period) ?? 0,
        budget: budgets.get(period) ?? 0,
        targets: targets.map((target) => ({ ...target })),
        valuations: portfolioHistory(),
        saved: confirmed.filter((entry) => entry.kind === 'saving').reduce((sum, entry) => sum - entry.amount, 0),
        cashIn: cash.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0),
        cashOut: cash.reduce((sum, entry) => sum + Math.max(0, -entry.amount), 0),
        invested: investments.reduce((total, investment) => total + investment.value, 0),
        recent: confirmed.slice(0, 6),
        upcoming,
        installments: all.filter((entry) => (entry.installmentCount ?? 0) > 1 && isExpense(entry)),
        trend: Array.from({ length: 6 }, (_, i) => {
          const previous = shiftMonth(period, i - 5);
          const summary = monthly(previous);
          const received = summary.confirmed.filter((entry) => entry.kind === 'income').reduce((sum, entry) => sum + entry.amount, 0);
          return { month: previous, income: received, expenses: summary.expenses };
        }),
        categories: Array.from(categoryTotals, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
        accounts: [...accounts], cards: [...cards], investments: [...investments], recurrences: [...recurrences],
        invoices: monthInvoices, coverage: coverage.filter((item) => item.month === period),
        summary: dismissedSummaries.has(lastMonth()) ? null : summaryOf(lastMonth()),
        categoryBudgets: [...categoryBudgets].map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => a.category.localeCompare(b.category, 'pt-BR')),
      };
    },
    async analysis(date, period) {
      const window = spendingWindow(date, period);
      return summarizeSpending(entries.filter((entry) =>
        entry.status === 'confirmed' && isExpense(entry) && entry.date >= window.previous && entry.date < window.end
      ).map(({ date, category, amount }) => ({ date, category, amount: -amount })), window, period);
    },
    async history(period, offset, limit) {
      return items(period).slice(offset, offset + limit).map((entry) => ({
        ...entry,
        allocatedAmount: allocations.filter((item) => item.paymentId === entry.id).reduce((sum, item) => sum + item.amount, 0),
      }));
    },
    async mutate(action) {
      switch (action.type) {
        case 'saveEntry': {
          const current = entries.find((entry) => entry.id === action.entry.id);
          if (current && allocations.some((item) => item.paymentId === current.id) &&
            (action.entry.amount !== current.amount || action.entry.kind !== 'card_payment')) {
            throw new Error('O pagamento já está vinculado a uma fatura.');
          }
          const id = current?.id ?? crypto.randomUUID();
          put(entries, { ...action.entry, id, source: current?.source ?? (action.entry.recurrenceId ? 'recurrence' : 'manual') });
          return;
        }
        case 'deleteEntry':
          if (allocations.some((item) => item.paymentId === action.id)) throw new Error('O pagamento está vinculado a uma fatura.');
          remove(entries, action.id);
          return;
        case 'saveAccount':
          put(accounts, { ...action.account, id: action.account.id ?? crypto.randomUUID() });
          return;
        case 'saveCard': {
          const { id, name, dueDay, closingDay } = action.card;
          const bank = action.card.bank?.trim();
          const previous = cards.find((card) => card.id === id);
          let account = bank ? accounts.find((item) =>
            item.id === previous?.accountId && item.name.trim().toLowerCase() === bank.toLowerCase()
          ) ?? accounts.find((item) => item.name.trim().toLowerCase() === bank.toLowerCase()) : undefined;
          if (bank && !account) {
            account = { id: crypto.randomUUID(), name: bank };
            accounts.push(account);
          }
          const design = action.card.design === undefined ? previous?.design : action.card.design ?? undefined;
          put(cards, { ...previous, id: id ?? crypto.randomUUID(), name, dueDay, closingDay, design, accountId: account?.id });
          return;
        }
        case 'archiveCard': {
          const card = cards.find((item) => item.id === action.id);
          if (!card) throw new Error('Cartão não encontrado.');
          put(cards, { ...card, archived: true });
          // Same as the database: from this month on, the account pays what was charged on the card.
          const thisMonth = currentMonth();
          for (const rule of recurrences.filter((item) => item.cardId === card.id)) {
            if (rule.startMonth >= thisMonth) put(recurrences, { ...rule, cardId: undefined });
            else if (!rule.endMonth || rule.endMonth >= thisMonth) {
              put(recurrences, { ...rule, endMonth: shiftMonth(thisMonth, -1) });
              recurrences.push({ ...rule, id: crypto.randomUUID(), startMonth: thisMonth, cardId: undefined });
            }
          }
          return;
        }
        case 'saveInvestment': {
          const investment = { ...action.investment, id: action.investment.id ?? crypto.randomUUID() };
          put(investments, investment);
          const points = (values.get(investment.id) ?? []).filter(({ date }) => date !== investment.updatedOn);
          values.set(investment.id, [...points, { date: investment.updatedOn, value: investment.value }]);
          return;
        }
        case 'deleteInvestment':
          remove(investments, action.id);
          values.delete(action.id);
          return;
        case 'saveRecurrence': {
          const previous = recurrences.find((item) => item.id === action.recurrence.id);
          if (previous && action.effectiveMonth && action.effectiveMonth > previous.startMonth) {
            previous.endMonth = shiftMonth(action.effectiveMonth, -1);
            put(recurrences, { ...action.recurrence, id: crypto.randomUUID(), startMonth: action.effectiveMonth });
          } else {
            put(recurrences, { ...action.recurrence, id: action.recurrence.id ?? crypto.randomUUID() });
          }
          return;
        }
        case 'endRecurrence': {
          const rule = recurrences.find((item) => item.id === action.id);
          if (rule) rule.endMonth = action.endMonth;
          return;
        }
        case 'saveGoal':
          goals.set(action.month, action.amount);
          return;
        case 'saveBudget':
          budgets.set(action.month, action.amount);
          return;
        case 'saveTarget': {
          const id = action.target.id ?? crypto.randomUUID();
          const previous = targets.find((target) => target.id === id);
          put(targets, { ...action.target, id, saved: previous?.saved ?? 0 });
          return;
        }
        case 'deleteTarget':
          remove(targets, action.id);
          return;
        case 'contributeTarget': {
          const target = targets.find((item) => item.id === action.id);
          if (!target || action.amount <= 0) throw new Error('Informe um valor positivo para o aporte.');
          target.saved += action.amount;
          return;
        }
        case 'addInstallments': {
          const card = cards.find((item) => item.id === action.cardId);
          if (!card) throw new Error('Escolha um cartão.');
          const base = Math.floor(action.total / action.count);
          const remainder = action.total % action.count;
          for (let index = 0; index < action.count; index++) {
            const period = shiftMonth(action.firstMonth, index);
            seed(dateInMonth(period, card.dueDay ?? 31), action.description, -(base + Number(index < remainder)), 'expense', action.category, {
              source: 'installment', invoiceMonth: period, accountId: undefined, cardId: card.id,
              installmentNumber: index + 1, installmentCount: action.count, status: 'planned',
            });
          }
          return;
        }
        case 'saveInvoiceDates': {
          const key = `${action.cardId}:${action.month.slice(0, 7)}`;
          if (action.closingDate && action.dueDate && action.dueDate <= action.closingDate) {
            throw new Error('O vencimento precisa ser depois do fechamento.');
          }
          if (!action.closingDate && !action.dueDate) invoiceDateOverrides.delete(key);
          else invoiceDateOverrides.set(key, { closingDate: action.closingDate, dueDate: action.dueDate });
          return;
        }
        case 'saveCategoryBudget': {
          const category = action.category.trim();
          if (!category) throw new Error('Escolha uma categoria.');
          if (action.amount > 0) categoryBudgets.set(category, action.amount);
          else categoryBudgets.delete(category);
          return;
        }
        case 'settleInvoice': {
          const payment = entries.find((entry) => entry.id === action.paymentId && entry.kind === 'card_payment');
          const invoice = invoices(action.month).find((item) => item.cardId === action.cardId);
          const paid = allocations.filter((item) => item.paymentId === action.paymentId).reduce((sum, item) => sum + item.amount, 0);
          if (!payment || !invoice || action.amount <= 0 || action.amount > Math.min(-payment.amount - paid, invoice.total - invoice.paid)) {
            throw new Error('Informe um valor disponível no pagamento e na fatura.');
          }
          allocations.push(action);
        }
      }
    },
    async confirmImport(payload) {
      const scope = payload.accountId ?? `${payload.cardId}:${payload.month}`;
      const hash = `${payload.type}:${scope}:${payload.fileHash}`;
      let inserted = 0;
      let linked = 0;
      let skipped = 0;
      if (imported.has(hash)) return { inserted, linked, skipped: payload.rows.length };
      const card = cards.find((item) => item.id === payload.cardId);
      if (payload.type === 'invoice' && (!card || !payload.month)) throw new Error('Escolha um cartão e o mês da fatura.');
      for (const row of payload.rows) {
        const external = row.externalId ? `${scope}:${row.externalId}` : undefined;
        if (external && externalIds.has(external)) {
          skipped++;
          continue;
        }
        const match = row.matchId && entries.find((entry) => entry.id === row.matchId);
        if (match && match.amount === row.amount && match.cardId === card?.id && match.invoiceMonth === payload.month && match.source !== 'invoice') {
          match.status = 'confirmed';
          match.source = 'invoice';
          linked++;
        } else {
          const date = card?.dueDay && payload.month ? dateInMonth(payload.month, card.dueDay) : row.date;
          seed(date, row.description, row.amount, row.kind, row.category, {
            source: payload.type, accountId: payload.accountId, cardId: payload.cardId,
            invoiceMonth: payload.month, installmentNumber: row.installmentNumber, installmentCount: row.installmentCount,
          });
          inserted++;
        }
        if (external) externalIds.add(external);
      }
      if (payload.type === 'statement' && payload.from && payload.to) {
        for (let period = payload.from.slice(0, 7); period <= payload.to.slice(0, 7); period = shiftMonth(period, 1)) {
          coverage.push({
            month: period,
            from: period === payload.from.slice(0, 7) ? payload.from : dateInMonth(period, 1),
            to: period === payload.to.slice(0, 7) ? payload.to : dateInMonth(period, 31),
          });
        }
      }
      imported.add(hash);
      return { inserted, linked, skipped };
    },
    async saveProfile(name, avatar) {
      profile.name = name.trim();
      if (avatar === undefined) return;
      if (profile.avatarUrl) URL.revokeObjectURL(profile.avatarUrl);
      profile.avatarUrl = avatar ? URL.createObjectURL(avatar) : undefined;
    },
    async changePassword() { throw new Error('A senha fica disponível na sua conta autenticada.'); },
    assistant: demoAssistant,
    push: demoPush(),
    summaries: {
      async list() {
        return [1, 2, 3].map((back) => summaryOf(shiftMonth(currentMonth(), -back))).filter((item) => item !== null);
      },
      async dismiss(period) { dismissedSummaries.add(period); },
      async generate() { return summaryOf(lastMonth()); },
    },
  };
}

/**
 * The demo has no server to send pushes: it remembers the choices while the page is open and the
 * test notification is shown by the device itself.
 */
function demoPush(): PushNotifications {
  const devices = new Map<string, PushPreferences>();
  return {
    async publicKey() { return null; },
    async preferences(endpoint) { return devices.get(endpoint) ?? null; },
    async save({ endpoint }, preferences) { devices.set(endpoint, normalizePreferences(preferences)); },
    async remove(endpoint) { devices.delete(endpoint); },
    async test() {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        throw new Error('Permita as notificações no navegador para ver o teste.');
      }
      const title = 'Notificações ativadas';
      const options = {
        body: 'Na demonstração o aviso sai do próprio aparelho; na sua conta, ele vem do servidor.',
        icon: '/icons/icon-192.png', tag: 'teste', data: { url: '/?abrir=profile' },
      };
      const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
      try {
        if (registration) await registration.showNotification(title, options);
        else new Notification(title, options);
      } catch {
        throw new Error('Este navegador só mostra notificações com o app instalado.');
      }
    },
  };
}

/** No AI in the demo: answers with the key lines the app computed, typed out like the real chat. */
const demoAssistant: Assistant = {
  async ask(question, context, _history, onText) {
    // Only the simulation part when there is one, so summary lines don't repeat.
    const simulation = context.indexOf('SIMULAÇÃO');
    const key = (simulation >= 0 ? context.slice(simulation) : context)
      .split('\n')
      .filter((line) => /^(Mês mais apertado|Meses que ficam|Nenhum mês|Meta mensal|Sobra média|Limite disponível|Recebido no mês)/.test(line));
    const actions = demoActions(question);
    const answer = actions
      ? `Na demonstração o assistente não usa a IA; na sua conta, ela entende o pedido e propõe o cadastro.${actions}`
      : [
        'Na demonstração o assistente não usa a IA; na sua conta, ela explica estes números em linguagem natural.',
        ...(key.length ? key.map((line) => `• ${line}`) : [`Sua pergunta foi: "${question}".`]),
      ].join('\n');
    for (const word of answer.split(/(?<= )/)) {
      onText(word);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return answer;
  },
};

/** Imitates the AI's ```acoes block for "anota", "vou receber" and "vou parcelar" in the demo. */
function demoActions(question: string) {
  const text = question.toLowerCase();
  if (!/(anot|cadastr|registr|receb|ganh|assum)/.test(text)) return '';
  const value = text.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?\s*(mil|k)?/);
  if (!value) return '';
  const reais = Number(value[1].replace(/\./g, '')) * (value[2] ? 1000 : 1);
  const count = text.match(/(\d{1,2})\s*(?:x|vezes)\b/);
  const month = shiftMonth(currentMonth(), 1);
  const action = /(receb|ganh)/.test(text)
    ? { tipo: 'receita', descricao: /freela/.test(text) ? 'Freela' : 'Receita extra', valor: reais, mes: month }
    : count
      ? { tipo: 'parcelado', descricao: 'Compra parcelada', valor_total: reais, parcelas: Number(count[1]) }
      : { tipo: 'despesa', descricao: 'Conta prevista', valor: reais, mes: month };
  return `\nDeixei pronto para você conferir e confirmar.\n\`\`\`acoes\n${JSON.stringify([action])}\n\`\`\``;
}

function isExpense(entry: Entry) {
  return entry.kind === 'expense' || entry.kind === 'refund';
}

function put<T extends { id: string }>(list: T[], value: T) {
  const index = list.findIndex((item) => item.id === value.id);
  if (index < 0) list.push(value);
  else list[index] = value;
}

function remove<T extends { id: string }>(list: T[], id: string) {
  const index = list.findIndex((item) => item.id === id);
  if (index >= 0) list.splice(index, 1);
}
