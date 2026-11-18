import type { Card, Entry, EntryKind, FinanceService, Investment, Invoice, Recurrence, SavingsTarget } from "../contracts";

export type Page =
  | "home"
  | "activity"
  | "analytics"
  | "budget"
  | "cards"
  | "commitments"
  | "investments"
  | "goals"
  | "import"
  | "profile"
  | "more";
export type EditModal =
  | { type: "entry"; item?: Entry; kind?: EntryKind }
  | { type: "investment"; item?: Investment }
  | { type: "recurrence"; item?: Recurrence }
  | { type: "settle"; item: Invoice }
  | { type: "target"; item?: SavingsTarget; name?: string }
  | { type: "contribution"; item: SavingsTarget }
  | { type: "card"; item?: Card }
  | { type: "commitment" }
  | { type: "budget"; item?: never };

export type OpenEditor = (modal: EditModal) => void;

export type FinanceCommands = Pick<
  FinanceService,
  "history" | "mutate" | "confirmImport" | "saveProfile" | "changePassword" | "dashboard" | "analysis"
> & { refresh: () => Promise<void> };
