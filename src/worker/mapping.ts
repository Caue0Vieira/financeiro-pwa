import { dateInMonth, invoiceMonthOf, shiftMonth } from "../date.ts";

/** Pure mapping of Pluggy accounts and transactions to app rows. No I/O, so it is unit tested. */

export type PluggyAccount = {
  id: string;
  type: "BANK" | "CREDIT";
  subtype?: string;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  /** BANK: available to spend. CREDIT: open balance of the current invoice (used limit). */
  balance?: number | null;
  /** Account holder's name; Pix to or from it is a transfer between the user's own accounts. */
  owner?: string | null;
  creditData?: {
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
  } | null;
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
  kind: "income" | "expense" | "card_payment" | "investment" | "refund" | "transfer";
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

/**
 * First day of the month whose invoice a purchase falls into (the month the invoice is due),
 * matching invoiceDates() in src/date.ts: closes before the due day → due the same month.
 */
export function invoiceMonthFor(date: string, closingDay: number | null, dueDay: number | null) {
  const month = invoiceMonthOf(date, closingDay, dueDay);
  return month && `${month}-01`;
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

const plain = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

/** Money moved into or out of a savings pot of the same bank (Mercado Pago "Cofrinho", Nubank "Caixinha"…). */
const isReserve = (tx: PluggyTransaction) =>
  /\b(dinheiro|valor) (reservado|retirado|guardado|resgatado)\b|\b(cofrinho|caixinha|porquinho)s?\b/.test(plain(tx.description));

/** Transfer between the user's own accounts: Pluggy says so, or the other party is the account holder. */
function isOwnTransfer(tx: PluggyTransaction, owner: string | null | undefined) {
  if (/same person transfer|transfer - internal/i.test(tx.category ?? "")) return true;
  const holder = plain(owner ?? "");
  return holder.split(" ").length >= 2 && ` ${plain(tx.description)} `.includes(` ${holder} `);
}

const isYield = (tx: PluggyTransaction) =>
  /proceeds interests|dividends/i.test(tx.category ?? "") || /^rendimentos?\b/.test(plain(tx.description));

/**
 * One Pluggy transaction as an app row, or null when it must not be imported: a pending bank
 * transaction, a future card installment (the app projects those itself) or a card-side bill
 * payment (the bank side records it). Purchases of the open card invoice arrive PENDING and keep
 * their id once posted, so they are imported.
 */
export function mapTransaction(
  tx: PluggyTransaction,
  account: Pick<PluggyAccount, "type"> & { owner?: string | null },
  context: {
    closingDay: number | null;
    dueDay: number | null;
    purchasesNegative: boolean;
    categorize: (description: string) => string;
    /** São Paulo calendar day; card transactions after it are future installments. */
    today?: string;
  },
): TransactionRow | null {
  if (!tx.amount) return null;
  if (tx.status === "PENDING") {
    if (account.type !== "CREDIT") return null;
    if (saoPauloDate(tx.date) > (context.today ?? saoPauloDate(new Date().toISOString()))) return null;
  }
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
  const amount_cents = income ? cents : -cents;
  // Neither income nor expense: the money stays with the user.
  if (isReserve(tx)) return { ...base, amount_cents, kind: "transfer", category: "Cofrinho" };
  if (isOwnTransfer(tx, account.owner)) return { ...base, amount_cents, kind: "transfer", category: "Transferências" };
  if (income && isYield(tx)) return { ...base, amount_cents, kind: "income", category: "Rendimentos" };
  const name = category(tx, context.categorize, income);
  return {
    ...base,
    amount_cents,
    kind: income ? "income" : name === "Investimentos" ? "investment" : "expense",
    category: name,
  };
}

/**
 * Some cards send every installment of a purchase at once, all on the purchase date (Duo Gourmet
 * in 12x came as 12 rows on 05/11), so they would all land in one invoice. Installments of the
 * same purchase on the same day move to their own month: number n goes n - first months later.
 * Purchases whose installments already come one per month are left as they are.
 */
export function spreadInstallments<T extends Pick<TransactionRow, "occurred_on" | "description" | "installment_number" | "installment_count" | "invoice_month">>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if ((row.installment_count ?? 1) < 2 || !row.installment_number) continue;
    const key = `${row.description}\u0000${row.installment_count}\u0000${row.occurred_on}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const moved = new Map<T, T>();
  for (const group of groups.values()) {
    if (new Set(group.map((row) => row.installment_number)).size < 2) continue;
    const first = Math.min(...group.map((row) => row.installment_number!));
    for (const row of group) {
      const months = row.installment_number! - first;
      if (!months) continue;
      const day = Number(row.occurred_on.slice(8, 10));
      moved.set(row, {
        ...row,
        occurred_on: dateInMonth(shiftMonth(row.occurred_on.slice(0, 7), months), day),
        invoice_month: row.invoice_month && `${shiftMonth(row.invoice_month.slice(0, 7), months)}-01`,
      });
    }
  }
  return rows.map((row) => moved.get(row) ?? row);
}
