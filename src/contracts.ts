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
  /** Free tags the user gave the entry. */
  tags?: string[];
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
  /** From Open Finance (cents): total limit, what is still available and the open invoice balance. */
  creditLimit?: number;
  availableLimit?: number;
  billBalance?: number;
  limitsUpdatedAt?: string;
}
export interface Investment {
  id: string;
  institution: string;
  name: string;
  contributed: number;
  value: number;
  updatedOn: string;
}
export interface Recurrence {
  id: string;
  description: string;
  amount: number;
  kind: 'income' | 'expense';
  category: string;
  startMonth: string;
  day: number;
  endMonth?: string;
  /** Card the charge goes on; each month's charge then joins that card's invoice. Expenses only. */
  cardId?: string;
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
  /** This month's installments of purchases split in parts (card invoice or account), planned or confirmed. */
  installments: Entry[];
  trend: { month: string; income: number; expenses: number }[];
  categories: { name: string; amount: number }[];
  accounts: Account[];
  cards: Card[];
  investments: Investment[];
  recurrences: Recurrence[];
  invoices: Invoice[];
  coverage: Coverage[];
  /** Spending limit per category (same every month); notices at 80% and 100%. */
  categoryBudgets: CategoryBudget[];
  /** Last month's summary while it wasn't dismissed (card on the home screen). */
  summary?: MonthlySummary | null;
  /** Day-by-day balance of the current month (null for other months); src/forecast.ts. */
  forecast?: BalanceForecast | null;
}

export interface BalanceForecast {
  /** "bank": starts from the accounts' balance (Open Finance); "month": from zero on day 1. */
  basis: 'bank' | 'month';
  /** Every day of the month; `projected` after today. */
  points: { date: string; balance: number; projected: boolean }[];
  today: number;
  end: number;
  lowest: { date: string; balance: number };
  /** First projected day below zero (null when it doesn't happen or it is already negative). */
  negativeOn: string | null;
}

export interface MonthlySummaryNumbers {
  income: number;
  expenses: number;
  balance: number;
  /** Up to 3 categories that grew the most against the month before. */
  growth: { category: string; amount: number; previous: number }[];
  /** Monthly savings goal; goalMet is null when there was none. */
  goal: number;
  goalMet: boolean | null;
  largest: { description: string; amount: number; date: string } | null;
}
export interface MonthlySummary extends MonthlySummaryNumbers {
  /** YYYY-MM of the summarised month. */
  month: string;
  /** Comment written by Workers AI (or by the app), without numbers. */
  text: string;
  dismissed: boolean;
}
export interface Summaries {
  /** Newest first. */
  list(): Promise<MonthlySummary[]>;
  dismiss(month: string): Promise<void>;
  /** Creates last month's summary now if it doesn't exist (otherwise returns it). */
  generate(): Promise<MonthlySummary | null>;
}

export interface CategoryBudget { category: string; amount: number }

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
  | { type: 'saveInvoiceDates'; cardId: string; month: string; closingDate: string | null; dueDate: string | null }
  /** Amount 0 removes the category's limit. */
  | { type: 'saveCategoryBudget'; category: string; amount: number };

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
  /** Every recorded entry dated from `from` to `to` (inclusive), for exports. */
  entries(from: string, to: string): Promise<Entry[]>;
  mutate(action: Action): Promise<void>;
  confirmImport(payload: ImportPayload): Promise<ImportResult>;
  saveProfile(name: string, avatar?: File | null): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  /** Open Finance through Pluggy; only with a real account (absent in the demo). */
  bankConnections?: BankConnections;
  /** Financial assistant (Workers AI); the demo answers locally. */
  assistant?: Assistant;
  /** Web Push on this user's devices; the demo keeps the subscription in memory. */
  push?: PushNotifications;
  /** Monthly summaries (generated by the Worker on the 1st; computed locally in the demo). */
  summaries?: Summaries;
  /** Recurring charges found in the history (src/subscriptions.ts) and the user's decisions. */
  subscriptions?: SubscriptionDetector;
  /** Photos and PDFs attached to entries (private storage in the real account). */
  receipts?: Receipts;
}

export interface Receipt {
  id: string;
  name: string;
  contentType: string;
  /** Bytes after the photo was reduced. */
  size: number;
  /** Short-lived link to open the file. */
  url: string;
  thumbnailUrl?: string;
  createdAt: string;
}
export interface Receipts {
  list(entryId: string): Promise<Receipt[]>;
  /** Reduces a photo before uploading it; PDFs go as they are (up to 5 MB). */
  add(entryId: string, file: File): Promise<Receipt>;
  remove(id: string): Promise<void>;
}

export type SubscriptionStatus = 'confirmed' | 'ignored';
export interface DetectedSubscription {
  /** Normalised merchant; decisions are stored by it. */
  key: string;
  name: string;
  cadence: 'monthly' | 'yearly';
  /** Latest charge and the one before it (positive cents). */
  amount: number;
  previousAmount?: number;
  /** Latest minus previous when it changed by 3% or more; 0 otherwise. */
  priceChange: number;
  monthlyCost: number;
  yearlyCost: number;
  lastDate: string;
  nextDate: string;
  /** Charges in the series. */
  charges: number;
  /** Started in the last two months and not reviewed yet. */
  isNew: boolean;
  status: SubscriptionStatus | 'suggested';
}
export interface SubscriptionDetector {
  list(): Promise<DetectedSubscription[]>;
  /** null forgets the decision (back to suggested). */
  decide(key: string, status: SubscriptionStatus | null): Promise<void>;
}

/** Which notices a device receives; defaults and parsing in src/notices.ts. */
export interface PushPreferences {
  /** Bill (not on a card) due tomorrow. */
  billDue: boolean;
  /** Card invoice closing in 2 days. */
  invoiceClosing: boolean;
  /** Expense from Open Finance at or above largeExpenseMin. */
  largeExpense: boolean;
  /** Cents. */
  largeExpenseMin: number;
  /** A category (or the month) passed 80% and 100% of its limit. */
  budget: boolean;
  /** Last month's summary is ready (day 1). */
  monthlySummary: boolean;
  /** The balance forecast shows a negative day this month. */
  negativeBalance: boolean;
  /** A new subscription was found or one got more expensive. */
  subscriptions: boolean;
}
export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }
export interface PushNotifications {
  /** VAPID public key (base64url); null when the server can't send (demo or keys not set). */
  publicKey(): Promise<string | null>;
  /** Preferences saved for this device's endpoint, or null when it isn't subscribed. */
  preferences(endpoint: string): Promise<PushPreferences | null>;
  save(subscription: PushSubscriptionKeys, preferences: PushPreferences): Promise<void>;
  remove(endpoint: string): Promise<void>;
  /** Sends a test notification to this device. */
  test(endpoint: string): Promise<void>;
}

export interface AssistantTurn { role: 'user' | 'assistant'; content: string }
export interface Assistant {
  /**
   * Asks about the account. `context` carries the numbers the app computed (summary and
   * simulation); `onText` receives the answer as it arrives. Resolves with the whole answer.
   */
  ask(question: string, context: string, history: AssistantTurn[], onText: (text: string) => void): Promise<string>;
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
