export type EntryKind = 'income' | 'expense' | 'transfer' | 'card_payment' | 'investment' | 'saving' | 'refund' | 'uncategorized';
export type EntryStatus = 'planned' | 'confirmed';
export type Source = 'manual' | 'statement' | 'invoice' | 'installment' | 'recurrence';

export interface Entry {
  id: string;
  date: string;
  description: string;
  amount: number;
  kind: EntryKind;
  category: string;
  status: EntryStatus;
  source: Source;
  accountId?: string;
  cardId?: string;
  recurrenceId?: string;
  installmentNumber?: number;
  installmentCount?: number;
  invoiceMonth?: string;
  allocatedAmount?: number;
}

export interface Account { id: string; name: string }
export interface Card {
  id: string;
  name: string;
  dueDay: number | null;
  /** Day the invoice closes; repeats every month like dueDay. */
  closingDay: number | null;
  /** Card model of the bank (e.g. 'prime'); missing means the standard card. */
  design?: string;
  accountId?: string;
  archived?: boolean;
}
export interface Investment {
  id: string;
  institution: string;
  name: string;
  contributed: number;
  value: number;
  updatedOn: string;
  /** B3 ticker (e.g. 'PETR4'); with `quantity`, the value follows the quote. */
  ticker?: string;
  quantity?: number;
  /** Last quote, in cents per unit, and when it was fetched. */
  price?: number;
  quotedAt?: string;
}
export interface QuoteRefresh { updated: number; failed: string[] }
export interface Recurrence {
  id: string;
  description: string;
  amount: number;
  kind: 'income' | 'expense';
  category: string;
  startMonth: string;
  day: number;
  endMonth?: string;
}
export interface Invoice {
  cardId: string;
  month: string;
  closingDate: string | null;
  dueDate: string | null;
  /** True when this month's dates were edited and differ from the card's days. */
  adjusted: boolean;
  total: number;
  paid: number;
}
export interface Coverage { month: string; from: string; to: string }
export interface Profile { name: string; avatarUrl?: string }
export interface Session { email: string }
export interface SavingsTarget { id: string; name: string; amount: number; saved: number }
export interface Valuation { date: string; value: number }
export type AnalysisPeriod = 'week' | 'month' | 'year';
export interface SpendingAnalysis {
  range: { start: string; end: string };
  total: number;
  previous: number;
  points: { date: string; amount: number }[];
  categories: { name: string; amount: number }[];
}

export interface Dashboard {
  month: string;
  profile: Profile;
  received: number;
  expectedIncome: number;
  expenses: number;
  toPay: number;
  projectedSurplus: number;
  goal: number;
  budget: number;
  targets: SavingsTarget[];
  valuations: Valuation[];
  saved: number;
  cashIn: number;
  cashOut: number;
  invested: number;
  recent: Entry[];
  upcoming: Entry[];
  trend: { month: string; income: number; expenses: number }[];
  categories: { name: string; amount: number }[];
  accounts: Account[];
  cards: Card[];
  investments: Investment[];
  recurrences: Recurrence[];
  invoices: Invoice[];
  coverage: Coverage[];
}

export type Action =
  | { type: 'saveEntry'; entry: Omit<Entry, 'id' | 'source'> & { id?: string } }
  | { type: 'deleteEntry'; id: string }
  | { type: 'saveAccount'; account: Omit<Account, 'id'> & { id?: string } }
  | { type: 'saveCard'; card: Pick<Card, 'name' | 'dueDay' | 'closingDay'> & { id?: string; bank?: string; design?: string | null } }
  | { type: 'archiveCard'; id: string }
  | { type: 'saveInvestment'; investment: Omit<Investment, 'id'> & { id?: string } }
  | { type: 'deleteInvestment'; id: string }
  | { type: 'saveRecurrence'; recurrence: Omit<Recurrence, 'id'> & { id?: string }; effectiveMonth?: string }
  | { type: 'endRecurrence'; id: string; endMonth: string }
  | { type: 'addInstallments'; cardId: string; description: string; category: string; total: number; count: number; firstMonth: string }
  | { type: 'saveGoal'; month: string; amount: number }
  | { type: 'saveBudget'; month: string; amount: number }
  | { type: 'saveTarget'; target: Pick<SavingsTarget, 'name' | 'amount'> & { id?: string } }
  | { type: 'deleteTarget'; id: string }
  | { type: 'contributeTarget'; id: string; amount: number }
  | { type: 'settleInvoice'; paymentId: string; cardId: string; month: string; amount: number }
  /** Both dates null restores the card's usual days for that month. */
  | { type: 'saveInvoiceDates'; cardId: string; month: string; closingDate: string | null; dueDate: string | null };

export interface ImportRow {
  date: string;
  description: string;
  amount: number;
  kind: EntryKind;
  category: string;
  externalId?: string;
  installmentNumber?: number;
  installmentCount?: number;
  matchId?: string;
}
export interface ImportPayload {
  type: 'statement' | 'invoice';
  accountId?: string;
  cardId?: string;
  month?: string;
  fileHash: string;
  from?: string;
  to?: string;
  rows: ImportRow[];
}
export interface ImportResult { inserted: number; linked: number; skipped: number }

export interface FinanceService {
  session(): Promise<Session | null>;
  onSessionChange(listener: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  dashboard(month: string): Promise<Dashboard>;
  analysis(date: string, period: AnalysisPeriod): Promise<SpendingAnalysis>;
  history(month: string, offset: number, limit: number): Promise<Entry[]>;
  mutate(action: Action): Promise<void>;
  confirmImport(payload: ImportPayload): Promise<ImportResult>;
  saveProfile(name: string, avatar?: File | null): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  /** Prices the investments that have a ticker with the latest B3 quote. */
  refreshQuotes(): Promise<QuoteRefresh>;
  /** Open Finance through Pluggy; only with a real account (absent in the demo). */
  bankConnections?: BankConnections;
}

export interface BankConnection { itemId: string; bank: string; status: string | null; lastSyncedAt: string | null }
export interface BankConnections {
  list(): Promise<BankConnection[]>;
  /** Short-lived token for the Pluggy Connect widget (new connection, or `itemId` to reconnect). */
  connectToken(itemId?: string): Promise<string>;
  /** Stores a connection created in the widget and imports its transactions. */
  register(itemId: string): Promise<{ inserted: number }>;
  sync(): Promise<{ inserted: number }>;
  remove(itemId: string): Promise<void>;
}
