import type { Dashboard, Recurrence } from "../contracts.ts";
import { invoiceMonthOf, shiftMonth, todayInSaoPaulo } from "../date.ts";
import { installmentPlans } from "./commitments.ts";

/**
 * Purchase simulation and account summary for the assistant. Every number the assistant shows
 * comes from here; Workers AI only explains this text, so it never does arithmetic.
 * Amounts are cents, like the rest of the app.
 */

export type PaymentMode = "card" | "account" | "cash";

export interface PurchaseInput {
  /** Total price in cents. */
  total: number;
  /** 1 for a single payment. */
  count: number;
  mode: PaymentMode;
  cardId?: string;
  /** Month of the first installment; defaults to the card invoice the purchase falls into. */
  firstMonth?: string;
  /** YYYY-MM-DD; defaults to today in São Paulo. */
  today?: string;
}

export interface MonthProjection {
  month: string;
  income: number;
  fixed: number;
  /** Installments already running (not counting this purchase). */
  installments: number;
  variable: number;
  /** Before the purchase. */
  surplus: number;
  /** This purchase's payment in the month. */
  payment: number;
  /** After the purchase. */
  after: number;
}

export interface PurchaseSimulation {
  total: number;
  count: number;
  installment: number;
  mode: PaymentMode;
  cardName?: string;
  firstMonth: string;
  lastMonth: string;
  months: MonthProjection[];
  /** Month with the smallest surplus after the purchase. */
  tightest: MonthProjection;
  negativeMonths: string[];
  /** Monthly savings goal set in the app (0 when none). */
  monthlyGoal: number;
  monthsBelowGoal: string[];
  /** Average surplus before the purchase over the simulated months. */
  averageSurplus: number;
  /** How many months of surplus the purchase takes; null when there is no surplus. */
  surplusMonths: number | null;
  targets: { name: string; remaining: number; monthsBefore: number | null; monthsAfter: number | null }[];
  invested: number;
  /** Share of the investments a cash payment would take (0..1); null when nothing is invested. */
  investedShare: number | null;
  /** Card available limit and whether the whole purchase fits; null when unknown. */
  availableLimit: number | null;
  fitsLimit: boolean | null;
  assumptions: string[];
}

const activeIn = (rule: Recurrence, month: string) => rule.startMonth <= month && (!rule.endMonth || rule.endMonth >= month);
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** Averages of the closed months in the trend (the current one is still incomplete). */
function averages(data: Pick<Dashboard, "trend" | "month">) {
  const closed = data.trend.filter(({ month }) => month < data.month);
  const months = closed.length ? closed : data.trend;
  return {
    months: months.length,
    income: Math.round(mean(months.map(({ income }) => income))),
    expenses: Math.round(mean(months.map(({ expenses }) => expenses))),
  };
}

type Baseline = ReturnType<typeof baselineOf>;

/** What the month looks like without the purchase: rules, running installments and average variable spending. */
function baselineOf(data: Dashboard) {
  const history = averages(data);
  const plans = installmentPlans(data.installments);
  const incomeRules = (month: string) =>
    data.recurrences.filter((rule) => rule.kind === "income" && activeIn(rule, month)).reduce((sum, rule) => sum + Math.abs(rule.amount), 0);
  const fixed = (month: string) =>
    data.recurrences.filter((rule) => rule.kind === "expense" && activeIn(rule, month)).reduce((sum, rule) => sum + Math.abs(rule.amount), 0);
  const installments = (month: string) =>
    plans.filter((plan) => month >= data.month && month <= plan.lastMonth).reduce((sum, plan) => sum + plan.amount, 0);
  // Past spending already includes the fixed bills and installments; what is left is the variable part.
  const variable = Math.max(0, history.expenses - fixed(data.month) - installments(data.month));
  const usesRules = incomeRules(data.month) > 0;
  const project = (month: string): Omit<MonthProjection, "payment" | "after"> => {
    const income = usesRules ? incomeRules(month) : history.income;
    const row = { month, income, fixed: fixed(month), installments: installments(month), variable };
    return { ...row, surplus: row.income - row.fixed - row.installments - row.variable };
  };
  return { history, usesRules, project };
}

function assumptionsOf(baseline: Baseline) {
  const notes = [
    baseline.usesRules
      ? "Renda: receitas recorrentes cadastradas."
      : `Renda: média dos últimos ${baseline.history.months || 0} meses fechados.`,
    "Gastos fixos: contas recorrentes cadastradas.",
    "Parcelas: as que já estão em andamento, até a última.",
    `Gasto variável: média dos últimos ${baseline.history.months || 0} meses, sem fixos e parcelas.`,
  ];
  if (!baseline.history.months) notes.push("Ainda não há histórico de meses fechados; a projeção fica menos precisa.");
  return notes;
}

/** Months needed to save `remaining` from a monthly surplus (null when it never gets there). */
const monthsToSave = (remaining: number, monthly: number) => (remaining <= 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null);

export function simulatePurchase(data: Dashboard, input: PurchaseInput): PurchaseSimulation {
  const total = Math.max(0, Math.round(input.total));
  const count = input.mode === "cash" ? 1 : Math.max(1, Math.min(48, Math.round(input.count)));
  const today = input.today ?? todayInSaoPaulo();
  const reference = today.slice(0, 7) === data.month ? today : `${data.month}-01`;
  const card = input.mode === "card" ? data.cards.find(({ id }) => id === input.cardId) : undefined;
  const firstMonth =
    input.firstMonth ??
    (input.mode === "cash"
      ? data.month
      : input.mode === "card"
        ? invoiceMonthOf(reference, card?.closingDay ?? null, card?.dueDay ?? null) ?? shiftMonth(data.month, 1)
        : shiftMonth(data.month, 1));
  const lastMonth = shiftMonth(firstMonth, count - 1);
  // Installments split like the stores do: the first ones carry the leftover cents.
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  const payment = (index: number) => base + (index < remainder ? 1 : 0);

  const baseline = baselineOf(data);
  const months: MonthProjection[] = Array.from({ length: count }, (_, index) => {
    const row = baseline.project(shiftMonth(firstMonth, index));
    return { ...row, payment: payment(index), after: row.surplus - payment(index) };
  });
  const tightest = months.reduce((low, month) => (month.after < low.after ? month : low), months[0]);
  const averageSurplus = Math.round(mean(months.map(({ surplus }) => surplus)));
  const averageAfter = Math.round(mean(months.map(({ after }) => after)));
  const invested = data.investments.reduce((sum, item) => sum + item.value, 0);

  return {
    total,
    count,
    installment: payment(0),
    mode: input.mode,
    cardName: card?.name,
    firstMonth,
    lastMonth,
    months,
    tightest,
    negativeMonths: months.filter(({ after }) => after < 0).map(({ month }) => month),
    monthlyGoal: data.goal,
    monthsBelowGoal: data.goal > 0 ? months.filter(({ after }) => after < data.goal).map(({ month }) => month) : [],
    averageSurplus,
    surplusMonths: averageSurplus > 0 ? Math.round((total / averageSurplus) * 10) / 10 : null,
    targets: data.targets.map(({ name, amount, saved }) => {
      const remaining = Math.max(0, amount - saved);
      const before = monthsToSave(remaining, averageSurplus);
      // During the installments the surplus is smaller; afterwards it is back to normal.
      let after: number | null = null;
      if (remaining <= 0) after = 0;
      else if (averageAfter > 0 && averageAfter * count >= remaining) after = Math.ceil(remaining / averageAfter);
      else if (averageSurplus > 0) after = count + Math.ceil((remaining - Math.max(0, averageAfter) * count) / averageSurplus);
      return { name, remaining, monthsBefore: before, monthsAfter: after };
    }),
    invested,
    investedShare: invested > 0 ? total / invested : null,
    availableLimit: card?.availableLimit ?? null,
    fitsLimit: card?.availableLimit === undefined ? null : card.availableLimit >= total,
    assumptions: assumptionsOf(baseline),
  };
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (cents: number) => currency.format((cents || 0) / 100);
const percent = (share: number) => `${Math.round(share * 1000) / 10}%`.replace(".", ",");

const modeLabel: Record<PaymentMode, string> = {
  card: "no cartão de crédito",
  account: "parcelado no boleto ou carnê",
  cash: "à vista",
};

/** Plain text the assistant receives for a purchase question. */
export function describeSimulation(sim: PurchaseSimulation) {
  const lines = [
    `SIMULAÇÃO DE COMPRA (calculada pelo app; use estes números, não recalcule)`,
    `Compra: ${brl(sim.total)} ${modeLabel[sim.mode]}${sim.cardName ? ` (${sim.cardName})` : ""}` +
      (sim.count > 1 ? `, ${sim.count}x de ${brl(sim.installment)}, de ${sim.firstMonth} a ${sim.lastMonth}.` : `, em ${sim.firstMonth}.`),
    `Mês a mês (renda − fixos − parcelas atuais − variável = sobra; sobra depois da compra):`,
    ...sim.months.map(
      (m) => `- ${m.month}: ${brl(m.income)} − ${brl(m.fixed)} − ${brl(m.installments)} − ${brl(m.variable)} = ${brl(m.surplus)}; depois da compra ${brl(m.after)}`,
    ),
    `Mês mais apertado: ${sim.tightest.month}, sobra de ${brl(sim.tightest.after)} depois da compra.`,
    sim.negativeMonths.length
      ? `Meses que ficam negativos: ${sim.negativeMonths.join(", ")}.`
      : `Nenhum mês fica negativo.`,
  ];
  if (sim.monthlyGoal > 0) {
    lines.push(
      sim.monthsBelowGoal.length
        ? `Meta mensal de economia de ${brl(sim.monthlyGoal)}: não é atingida em ${sim.monthsBelowGoal.length} de ${sim.count} meses (${sim.monthsBelowGoal.join(", ")}).`
        : `Meta mensal de economia de ${brl(sim.monthlyGoal)}: continua sendo atingida em todos os meses.`,
    );
  }
  lines.push(
    sim.surplusMonths === null
      ? `Sobra média antes da compra: ${brl(sim.averageSurplus)} (sem sobra positiva).`
      : `Sobra média antes da compra: ${brl(sim.averageSurplus)}; a compra equivale a ${String(sim.surplusMonths).replace(".", ",")} meses dessa sobra.`,
  );
  for (const target of sim.targets) {
    const when = (months: number | null) => (months === null ? "sem previsão" : months === 1 ? "1 mês" : `${months} meses`);
    lines.push(`Meta "${target.name}": faltam ${brl(target.remaining)}; antes ${when(target.monthsBefore)}, com a compra ${when(target.monthsAfter)} (se toda a sobra fosse para ela).`);
  }
  lines.push(
    sim.investedShare === null
      ? `Investimentos: nenhum registrado.`
      : `Investimentos: ${brl(sim.invested)}; a compra equivale a ${percent(sim.investedShare)} desse valor.`,
  );
  if (sim.availableLimit !== null) {
    lines.push(`Limite disponível do cartão: ${brl(sim.availableLimit)}; ${sim.fitsLimit ? "a compra cabe" : "a compra NÃO cabe"} no limite.`);
  }
  lines.push(`Premissas: ${sim.assumptions.join(" ")}`);
  return lines.join("\n");
}

/** Plain text summary of the selected month, sent with every assistant question. */
export function financialSummary(data: Dashboard) {
  const history = averages(data);
  const plans = installmentPlans(data.installments);
  const fixed = data.recurrences.filter((rule) => rule.kind === "expense" && activeIn(rule, data.month));
  const income = data.recurrences.filter((rule) => rule.kind === "income" && activeIn(rule, data.month));
  const invested = data.investments.reduce((sum, item) => sum + item.value, 0);
  const contributed = data.investments.reduce((sum, item) => sum + item.contributed, 0);
  const openInvoices = data.invoices.filter((invoice) => invoice.total - invoice.paid > 0);
  const lines = [
    `RESUMO FINANCEIRO (mês ${data.month}, valores do app)`,
    `Recebido no mês: ${brl(data.received)} de ${brl(data.expectedIncome)} esperados. Gastos no mês: ${brl(data.expenses)}. Ainda a pagar: ${brl(data.toPay)}. Sobra prevista: ${brl(data.projectedSurplus)}.`,
    data.budget > 0 ? `Orçamento de gastos do mês: ${brl(data.budget)}.` : `Sem orçamento de gastos definido.`,
    data.goal > 0 ? `Meta mensal de economia: ${brl(data.goal)}.` : `Sem meta mensal de economia.`,
    history.months
      ? `Média dos últimos ${history.months} meses fechados: renda ${brl(history.income)}, gastos ${brl(history.expenses)}.`
      : `Sem meses fechados no histórico.`,
    `Histórico: ${data.trend.map((t) => `${t.month} renda ${brl(t.income)} gastos ${brl(t.expenses)}`).join("; ") || "vazio"}.`,
    `Receitas recorrentes: ${income.map((r) => `${r.description} ${brl(Math.abs(r.amount))}`).join(", ") || "nenhuma"}.`,
    `Contas fixas e assinaturas (${brl(fixed.reduce((s, r) => s + Math.abs(r.amount), 0))}/mês): ${fixed.map((r) => `${r.description} ${brl(Math.abs(r.amount))}`).join(", ") || "nenhuma"}.`,
    `Parcelas em andamento: ${plans.map((p) => `${p.entry.description} ${p.number}/${p.count} de ${brl(p.amount)} até ${p.lastMonth}`).join(", ") || "nenhuma"}.`,
    `Gastos por categoria no mês: ${data.categories.slice(0, 10).map((c) => `${c.name} ${brl(c.amount)}`).join(", ") || "nenhum"}.`,
    `Faturas em aberto: ${openInvoices.map((i) => `${data.cards.find((c) => c.id === i.cardId)?.name ?? "cartão"} ${i.month} ${brl(i.total - i.paid)}${i.dueDate ? ` vence ${i.dueDate}` : ""}`).join(", ") || "nenhuma"}.`,
    `Cartões: ${data.cards.filter((c) => !c.archived).map((c) => `${c.name}${c.availableLimit !== undefined ? ` limite disponível ${brl(c.availableLimit)}` : ""}${c.creditLimit !== undefined ? ` de ${brl(c.creditLimit)}` : ""}`).join(", ") || "nenhum"}.`,
    `Metas: ${data.targets.map((t) => `${t.name} ${brl(t.saved)} de ${brl(t.amount)}`).join(", ") || "nenhuma"}.`,
    `Investimentos: ${brl(invested)} (aportado ${brl(contributed)}): ${data.investments.map((i) => `${i.name} ${brl(i.value)}`).join(", ") || "nenhum"}.`,
  ];
  return lines.join("\n");
}
