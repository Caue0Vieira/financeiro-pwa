import type { Card, Entry, EntryKind, FinanceService, Investment, Invoice, Recurrence, SavingsTarget } from "../contracts";

export type Page =
  | "home"
  | "activity"
  | "analytics"
  | "cards"
  | "commitments"
  | "investments"
  | "goals"
  | "import"
  | "connections"
  | "profile"
  | "assistant"
  | "more";
export type EditModal =
  | { type: "entry"; item?: Entry; kind?: EntryKind }
  | { type: "investment"; item?: Investment }
  | { type: "recurrence"; item?: Recurrence }
  | { type: "settle"; item: Invoice }
  | { type: "invoice-dates"; item: Invoice }
  | { type: "target"; item?: SavingsTarget; name?: string }
  | { type: "contribution"; item: SavingsTarget }
  | { type: "card"; item?: Card; standalone?: boolean }
  | { type: "card-picker" }
  | { type: "commitment"; mode?: CommitmentMode }
  | { type: "budget"; item?: never };

export type CommitmentMode = "monthly" | "subscription" | "installments" | "once";

export type OpenEditor = (modal: EditModal) => void;

export type FinanceCommands = Pick<
  FinanceService,
  "history" | "mutate" | "confirmImport" | "saveProfile" | "changePassword" | "dashboard" | "analysis" | "bankConnections" | "assistant"
> & { refresh: () => Promise<void> };
