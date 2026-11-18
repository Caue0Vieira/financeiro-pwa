/** Pure mapping of Pluggy accounts and transactions to app rows. No I/O, so it is unit tested. */

export type PluggyAccount = {
  id: string;
  type: "BANK" | "CREDIT";
  subtype?: string;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  creditData?: { balanceCloseDate?: string | null; balanceDueDate?: string | null } | null;
};

export type PluggyTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type?: "DEBIT" | "CREDIT";
  status?: "PENDING" | "POSTED";
  category?: string | null;
  creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null } | null;
};

export type TransactionRow = {
  occurred_on: string;
  description: string;
  amount_cents: number;
  kind: "income" | "expense" | "card_payment" | "investment" | "refund";
  category: string;
  status: "confirmed";
  source: "pluggy";
  external_id: string;
  installment_number: number | null;
  installment_count: number | null;
  invoice_month: string | null;
};

const saoPaulo = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Pluggy dates are UTC instants; the app keeps the calendar day in Brazil. */
export function saoPauloDate(iso: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : saoPaulo.format(new Date(iso));
}

const monthStart = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);

/**
 * First day of the month whose invoice a purchase falls into (the month the invoice is due),
 * matching invoiceDates() in src/date.ts: closes before the due day → due the same month.
 */
export function invoiceMonthFor(date: string, closingDay: number | null, dueDay: number | null) {
  if (closingDay === null || dueDay === null) return null;
  const [year, month, day] = date.split("-").map(Number);
  const closesInDueMonth = closingDay < dueDay;
  const afterClosing = day > closingDay;
  const shift = (closesInDueMonth ? 0 : 1) + (afterClosing ? 1 : 0);
  return monthStart(year, month - 1 + shift);
}

/** Banks as the app names them (src/frontend/components/BankIcon.tsx), found in account names. */
const knownBanks: [RegExp, string][] = [
  [/\binter\b/i, "Banco Inter"],
  [/\bnu(bank)?\b|nu pagamentos/i, "Nubank"],
  [/\bita[uú]\b/i, "Itaú"],
  [/santander/i, "Santander"],
  [/banco do brasil|\bbb\b|ourocard/i, "Banco do Brasil"],
  [/bradesco/i, "Bradesco"],
  [/\bcaixa\b/i, "Caixa"],
  [/\bc6\b/i, "C6 Bank"],
  [/\bbtg\b/i, "BTG Pactual"],
  [/sicoob/i, "Sicoob"],
  [/sicredi/i, "Sicredi"],
  [/\bneon\b/i, "Neon"],
  [/mercado ?pago/i, "Mercado Pago"],
];

/**
 * The bank behind an item. Meu Pluggy connections report the connector as "MeuPluggy", so the
 * bank is recognised from the accounts' names instead (e.g. "Inter Prime" → Banco Inter).
 */
export function bankNameFor(connectorName: string, accounts: readonly Pick<PluggyAccount, "name" | "marketingName">[]) {
  if (!/meu\s*pluggy/i.test(connectorName)) return connectorName;
  for (const account of accounts) {
    const text = `${account.marketingName ?? ""} ${account.name}`;
    const bank = knownBanks.find(([pattern]) => pattern.test(text))?.[1];
    if (bank) return bank;
  }
  return "Meu Pluggy";
}

export const dayOf =(iso?: string | null) => (iso ? Number(saoPauloDate(iso).slice(8, 10)) || null : null);

const isCardPayment = (tx: PluggyTransaction) =>
  /credit card payment/i.test(tx.category ?? "") ||
  /pagamento\s+(de\s+)?fatura|pgto\.?\s*fatura|fatura\s+(do\s+)?cart/i.test(tx.description);

/**
 * Pluggy documents card purchases as positive amounts, but some connectors (the sandbox among
 * them) send them negative. Decide per account from the charges themselves, ignoring payments.
 */
export function purchasesAreNegative(transactions: readonly PluggyTransaction[]) {
  let negative = 0;
  let positive = 0;
  for (const tx of transactions) {
    if (isCardPayment(tx) || tx.amount === 0) continue;
    if (tx.amount < 0) negative++;
    else positive++;
  }
  return negative > positive;
}

const pluggyCategories: [RegExp, string][] = [
  [/groceries|supermarket/i, "Mercado"],
  [/eating out|restaurant|food delivery|bakery|coffee/i, "Alimentação"],
  [/taxi|ride|transport|gas station|fuel|parking|toll|vehicle|airport|airline/i, "Transporte"],
  [/pharmac|health|hospital|clinic|dentist|medical|wellness/i, "Saúde"],
  [/rent|housing|utilities|electricity|water|internet|telecom|mobile|condominium/i, "Moradia"],
  [/streaming|digital services|software|subscription/i, "Assinaturas"],
  [/shopping|clothing|electronics|department store|online/i, "Compras"],
  [/leisure|entertainment|ticket|travel|accommodation|hotel|games|sport/i, "Lazer"],
  [/education|school|course|books/i, "Educação"],
  [/salary|wage/i, "Salário"],
  [/investment|savings|pension/i, "Investimentos"],
  [/\btax(es)?\b|\bfees?\b|\binterest\b/i, "Tarifas e impostos"],
  [/\btransfer|\b(pix|ted|doc)\b/i, "Transferências"],
];

function category(tx: PluggyTransaction, categorize: (description: string) => string, income: boolean) {
  const fromDescription = categorize(tx.description);
  if (fromDescription) return fromDescription;
  const fromPluggy = pluggyCategories.find(([pattern]) => pattern.test(tx.category ?? ""))?.[1];
  return fromPluggy ?? (income ? "Receitas" : "Sem categoria");
}

/**
 * One Pluggy transaction as an app row, or null when it must not be imported:
 * pending (its id changes once posted) or a card-side bill payment (the bank side records it).
 */
export function mapTransaction(
  tx: PluggyTransaction,
  account: Pick<PluggyAccount, "type">,
  context: {
    closingDay: number | null;
    dueDay: number | null;
    purchasesNegative: boolean;
    categorize: (description: string) => string;
  },
): TransactionRow | null {
  if (tx.status === "PENDING" || !tx.amount) return null;
  const cents = Math.round(Math.abs(tx.amount) * 100);
  if (!cents) return null;
  const occurredOn = saoPauloDate(tx.date);
  const base = {
    occurred_on: occurredOn,
    description: tx.description.trim() || "Lançamento",
    status: "confirmed" as const,
    source: "pluggy" as const,
    external_id: tx.id,
    installment_number: tx.creditCardMetadata?.installmentNumber ?? null,
    installment_count: tx.creditCardMetadata?.totalInstallments ?? null,
    invoice_month: null as string | null,
  };

  if (account.type === "CREDIT") {
    const charge = context.purchasesNegative ? tx.amount < 0 : tx.amount > 0;
    if (!charge && isCardPayment(tx)) return null;
    return {
      ...base,
      amount_cents: charge ? -cents : cents,
      kind: charge ? "expense" : "refund",
      category: charge ? category(tx, context.categorize, false) : "Estorno",
      invoice_month: invoiceMonthFor(occurredOn, context.closingDay, context.dueDay),
    };
  }

  const income = tx.amount > 0;
  if (!income && isCardPayment(tx)) {
    return { ...base, amount_cents: -cents, kind: "card_payment", category: "Cartão" };
  }
  const name = category(tx, context.categorize, income);
  return {
    ...base,
    amount_cents: income ? cents : -cents,
    kind: income ? "income" : name === "Investimentos" ? "investment" : "expense",
    category: name,
  };
}
