import { createClient } from "@supabase/supabase-js";
import { encodeAvatar } from "./avatar";
import { invoiceDates, todayInSaoPaulo } from "../date";
import { spendingWindow, summarizeSpending } from "./spending";
import type {
  BankConnections,
  FinanceService,
  Entry,
  Dashboard,
  Action,
  Session,
  SavingsTarget,
  Valuation,
} from "../contracts";

const first = (month: string) => `${month.slice(0, 7)}-01`;
const monthEnd = (month: string) => {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const entry = (r: any): Entry => ({
  id: r.id,
  date: r.occurred_on,
  description: r.description,
  amount: Number(r.amount_cents),
  kind: r.kind,
  category: r.category,
  status: r.status === "planned" ? "planned" : "confirmed",
  source:
    (
      {
        csv: "statement",
        ofx: "statement",
        recurring: "recurrence",
        settlement: "invoice",
      } as Record<string, Entry["source"]>
    )[r.source] ?? r.source,
  accountId: r.account_id ?? undefined,
  cardId: r.card_id ?? undefined,
  recurrenceId: r.recurring_rule_id ?? undefined,
  installmentNumber: r.installment_number ?? undefined,
  installmentCount: r.installment_count ?? undefined,
  invoiceMonth: r.invoice_month?.slice(0, 7),
  allocatedAmount:
    r.allocated_amount_cents == null
      ? undefined
      : Number(r.allocated_amount_cents),
});
const fail = (error: any) => {
  if (error) throw error;
};

export function createSupabaseService(
  url: string,
  key: string,
): FinanceService {
  const db = createClient(url, key);
  let avatarCache: { path: string; url: string; expires: number } | undefined;
  const user = async () => {
    const { data, error } = await db.auth.getUser();
    fail(error);
    if (!data.user) throw new Error("Sessão encerrada");
    return data.user;
  };
  const upsert = async (table: string, row: Record<string, unknown>) => {
    const { error } = await db.from(table).upsert(row);
    fail(error);
  };
  const remove = async (table: string, id: string) => {
    const { data, error } = await db
      .from(table)
      .delete()
      .eq("id", id)
      .select("id");
    fail(error);
    if (!data?.length)
      throw new Error("Não foi possível excluir este registro.");
  };
  const session = async (): Promise<Session | null> => {
    const { data, error } = await db.auth.getSession();
    fail(error);
    return data.session?.user.email ? { email: data.session.user.email } : null;
  };
  /** Calls the Worker's /api with the session token; the Pluggy secrets stay on the server. */
  const api = async <T>(path: string, method = "POST", body?: unknown): Promise<T> => {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("Sessão encerrada");
    const response = await fetch(`/api/pluggy/${path}`, {
      method,
      headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "Não foi possível falar com o servidor.");
    return result as T;
  };
  const bankConnections: BankConnections = {
    async list() {
      const { data, error } = await db.from("pluggy_items")
        .select("item_id, connector_name, status, last_synced_at").order("created_at");
      fail(error);
      return (data ?? []).map((x) => ({
        itemId: x.item_id, bank: x.connector_name, status: x.status, lastSyncedAt: x.last_synced_at,
      }));
    },
    connectToken: (itemId) => api<{ connectToken: string }>("connect-token", "POST", { itemId }).then((r) => r.connectToken),
    register: (itemId) => api("items", "POST", { itemId }),
    sync: () => api("sync"),
    remove: (itemId) => api<void>(`items/${encodeURIComponent(itemId)}`, "DELETE"),
  };
  return {
    session,
    bankConnections,
    onSessionChange(listener) {
      const { data } = db.auth.onAuthStateChange((_event, s) =>
        listener(s?.user.email ? { email: s.user.email } : null),
      );
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signOut() {
      const { error } = await db.auth.signOut();
      fail(error);
      avatarCache = undefined;
    },
    async changePassword(current, next) {
      const u = await user();
      if (!u.email) throw new Error("E-mail indisponível");
      const { error: e } = await db.auth.signInWithPassword({
        email: u.email,
        password: current,
      });
      fail(e);
      const { error } = await db.auth.updateUser({ password: next });
      fail(error);
    },
    async saveProfile(name, avatar) {
      const u = await user();
      const { data: existing, error: readError } = await db
        .from("profiles")
        .select("user_id,avatar_path")
        .eq("user_id", u.id)
        .maybeSingle();
      fail(readError);
      let avatar_path: string | null | undefined;
      if (avatar) {
        const photo = await encodeAvatar(avatar);
        avatar_path = `${u.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await db.storage
          .from("avatars")
          .upload(avatar_path, photo, {
            contentType: "image/jpeg",
          });
        fail(error);
      } else if (avatar === null) {
        if (existing?.avatar_path) {
          const { error } = await db.storage
            .from("avatars")
            .remove([existing.avatar_path]);
          fail(error);
        }
        avatar_path = null;
      }
      const row: Record<string, unknown> = { name };
      if (avatar_path !== undefined) row.avatar_path = avatar_path;
      const result = existing
        ? await db.from("profiles").update(row).eq("user_id", u.id)
        : await db.from("profiles").insert({ user_id: u.id, ...row });
      if (result.error) {
        if (avatar_path) await db.storage.from("avatars").remove([avatar_path]);
        fail(result.error);
      }
      if (avatar_path && existing?.avatar_path) {
        await db.storage.from("avatars").remove([existing.avatar_path]);
      }
      avatarCache = undefined;
    },
    async history(month, offset, limit) {
      const { data, error } = await db
        .from("transactions")
        .select("*")
        .gte("occurred_on", first(month))
        .lt("occurred_on", monthEnd(month))
        .neq("status", "review")
        .order("occurred_on", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + limit - 1);
      fail(error);
      return (data ?? []).map(entry);
    },
    async confirmImport(payload) {
      const { data, error } = await db.rpc("import_transactions", {
        p_payload: {
          ...payload,
          month: payload.month ? first(payload.month) : null,
        },
      });
      fail(error);
      return data;
    },
    async mutate(action: Action) {
      switch (action.type) {
        case "saveEntry": {
          const e = action.entry;
          const row = {
            occurred_on: e.date,
            description: e.description,
            amount_cents: e.amount,
            kind: e.kind,
            category: e.category,
            status: e.status,
            account_id: e.accountId ?? null,
            card_id: e.cardId ?? null,
            recurring_rule_id: e.recurrenceId ?? null,
            invoice_month: e.invoiceMonth ? first(e.invoiceMonth) : null,
          };
          if (e.id && !e.id.startsWith("recurrence:")) {
            const { data, error } = await db
              .from("transactions")
              .update(row)
              .eq("id", e.id)
              .select("id");
            fail(error);
            if (!data?.length)
              throw new Error("Não foi possível alterar este lançamento.");
          } else {
            const { error } = await db.from("transactions").insert({
              ...row,
              source: e.recurrenceId ? "recurring" : "manual",
            });
            fail(error);
          }
          break;
        }
        case "deleteEntry":
          await remove("transactions", action.id);
          break;
        case "saveAccount":
          await upsert("accounts", { ...action.account });
          break;
        case "saveCard": {
          const { id, name, bank, dueDay, closingDay } = action.card;
          const card = { p_id: id ?? null, p_name: name, p_bank: bank ?? null, p_due_day: dueDay };
          let { error } = await db.rpc("save_card", { ...card, p_closing_day: closingDay });
          // PGRST202: the invoice_dates migration (closing day) is not applied yet.
          if (error?.code === "PGRST202") ({ error } = await db.rpc("save_card", card));
          fail(error);
          if (id && action.card.design !== undefined) {
            const saved = await db.from("cards").update({ design: action.card.design }).eq("id", id);
            // PGRST204: the card_design migration is not applied yet; keep the standard model.
            if (saved.error?.code !== "PGRST204") fail(saved.error);
          }
          break;
        }
        case "archiveCard": {
          const { data, error } = await db.from("cards")
            .update({ archived: true })
            .eq("id", action.id)
            .select("id")
            .maybeSingle();
          fail(error);
          if (!data) throw new Error("Cartão não encontrado.");
          break;
        }
        case "saveInvestment": {
          const x = action.investment;
          await upsert("investments", {
            ...(x.id ? { id: x.id } : {}),
            name: x.name,
            institution: x.institution,
            contributed_cents: x.contributed,
            value_cents: x.value,
            as_of: x.updatedOn,
          });
          break;
        }
        case "deleteInvestment":
          await remove("investments", action.id);
          break;
        case "saveGoal": {
          const u = await user();
          await upsert("monthly_goals", {
            user_id: u.id,
            month: first(action.month),
            amount_cents: action.amount,
          });
          break;
        }
        case "saveBudget": {
          const u = await user();
          await upsert("monthly_budgets", { user_id: u.id, month: first(action.month), amount_cents: action.amount });
          break;
        }
        case "saveTarget": {
          const { id, name, amount } = action.target;
          await upsert("savings_goals", { ...(id ? { id } : {}), name, target_cents: amount });
          break;
        }
        case "deleteTarget":
          await remove("savings_goals", action.id);
          break;
        case "contributeTarget": {
          const { error } = await db.from("goal_contributions").insert({
            goal_id: action.id, amount_cents: action.amount, contributed_on: todayInSaoPaulo(),
          });
          fail(error);
          break;
        }
        case "addInstallments": {
          const { error } = await db.rpc("add_installments", {
            p_card: action.cardId,
            p_description: action.description,
            p_category: action.category,
            p_total: -Math.abs(action.total),
            p_count: action.count,
            p_first: first(action.firstMonth),
          });
          fail(error);
          break;
        }
        case "saveRecurrence": {
          const r = action.recurrence;
          const { error } = await db.rpc("save_recurrence", {
            p_data: {
              ...r,
              startMonth: first(r.startMonth),
              endMonth: r.endMonth ? first(r.endMonth) : null,
            },
            p_effective: action.effectiveMonth
              ? first(action.effectiveMonth)
              : null,
          });
          fail(error);
          break;
        }
        case "endRecurrence": {
          const end = new Date(`${monthEnd(action.endMonth)}T00:00:00Z`);
          end.setUTCDate(0);
          const { error } = await db
            .from("recurring_rules")
            .update({ ends_on: end.toISOString().slice(0, 10) })
            .eq("id", action.id);
          fail(error);
          break;
        }
        case "saveInvoiceDates": {
          const { cardId, month, closingDate, dueDate } = action;
          if (!closingDate && !dueDate) {
            const { error } = await db.from("card_invoice_dates").delete()
              .eq("card_id", cardId).eq("month", first(month));
            fail(error);
            break;
          }
          const u = await user();
          const { error } = await db.from("card_invoice_dates").upsert(
            { user_id: u.id, card_id: cardId, month: first(month), closing_on: closingDate, due_on: dueDate },
            { onConflict: "user_id,card_id,month" },
          );
          fail(error);
          break;
        }
        case "settleInvoice": {
          const { error } = await db.rpc("settle_invoice", {
            p_payment_id: action.paymentId,
            p_card_id: action.cardId,
            p_month: first(action.month),
            p_amount: action.amount,
          });
          fail(error);
          break;
        }
      }
    },
    async analysis(date, period) {
      const window = spendingWindow(date, period);
      const { data, error } = await db.rpc("nitido_expense_days", { p_start: window.previous, p_end: window.end });
      fail(error);
      const rows = (data as { date: string; category: string; amount: number }[]).map(
        (row) => ({ ...row, amount: Number(row.amount) }),
      );
      return summarizeSpending(rows, window, period);
    },
    async dashboard(month): Promise<Dashboard> {
      const [{ data, error }, planning, adjustedDates] = await Promise.all([
        db.rpc("monthly_dashboard", { p_month: first(month) }),
        db.rpc("nitido_planning", { p_month: first(month) }),
        db.from("card_invoice_dates").select("card_id, closing_on, due_on").eq("month", first(month)),
      ]);
      fail(error);
      fail(planning.error);
      // Until the card_invoice_dates migration is applied, fall back to the cards' usual days.
      const dateOverrides = (adjustedDates.error ? [] : adjustedDates.data) as {
        card_id: string; closing_on: string | null; due_on: string | null;
      }[];
      const { budget, targets, valuations } = planning.data as {
        budget: number; targets: SavingsTarget[]; valuations: Valuation[];
      };
      const {
        profile,
        accounts,
        cards,
        investments,
        goals,
        batches,
        rules,
        rows,
        invoice_rows,
        invoices,
        payments,
        trend,
      } = data as Record<
        | "profile"
        | "accounts"
        | "cards"
        | "investments"
        | "goals"
        | "batches"
        | "rules"
        | "rows"
        | "invoice_rows"
        | "invoices"
        | "payments"
        | "trend",
        any[]
      >;
      const entries: Entry[] = rows.map(entry);
      for (const r of rules) {
        if (
          r.starts_on >= monthEnd(month) ||
          (r.ends_on && r.ends_on < first(month)) ||
          entries.some((e) => e.recurrenceId === r.id)
        )
          continue;
        const last = new Date(`${monthEnd(month)}T00:00:00Z`);
        last.setUTCDate(0);
        const date = `${month.slice(0, 7)}-${String(Math.min(r.day_of_month, last.getUTCDate())).padStart(2, "0")}`;
        entries.push({
          id: `recurrence:${r.id}:${month}`,
          date,
          description: r.description,
          amount: Number(r.amount_cents),
          kind: r.kind,
          category: r.category,
          status: "planned",
          source: "recurrence",
          recurrenceId: r.id,
        });
      }
      const sum = (items: Entry[]) => items.reduce((a, e) => a + e.amount, 0);
      const confirmed = entries.filter((e) => e.status === "confirmed");
      const income = entries.filter((e) => e.kind === "income");
      const expenses = confirmed.filter((e) =>
        ["expense", "refund"].includes(e.kind),
      );
      let avatarUrl: string | undefined;
      if (profile[0]?.avatar_path) {
        const path = profile[0].avatar_path as string;
        if (avatarCache?.path === path && avatarCache.expires > Date.now()) {
          avatarUrl = avatarCache.url;
        } else {
          try {
            const { data } = await db.storage
              .from("avatars")
              .createSignedUrl(path, 3600);
            if (data?.signedUrl) {
              avatarUrl = data.signedUrl;
              avatarCache = {
                path,
                url: avatarUrl,
                expires: Date.now() + 55 * 60 * 1000,
              };
            }
          } catch {
            /* A missing avatar must not block financial data. */
          }
        }
      }
      const categoryMap = new Map<string, number>();
      for (const e of expenses)
        categoryMap.set(
          e.category,
          (categoryMap.get(e.category) ?? 0) - e.amount,
        );
      const invoiceEntries: Entry[] = invoice_rows.map(entry);
      const invoiceList = cards.map((c: any) => {
        const i = invoices.find((x: any) => x.card_id === c.id);
        const total = -sum(
          invoiceEntries.filter(
            (e) => e.cardId === c.id && ["expense", "refund"].includes(e.kind),
          ),
        );
        const paid = i
          ? payments
              .filter((p: any) => p.invoice_id === i.id)
              .reduce((a: number, p: any) => a + Number(p.amount_cents), 0)
          : 0;
        const override = dateOverrides.find((x) => x.card_id === c.id);
        return {
          cardId: c.id,
          month,
          ...invoiceDates(month, c.closing_day ?? null, c.due_day ?? null, {
            closingDate: override?.closing_on,
            dueDate: override?.due_on,
          }),
          total,
          paid,
        };
      });
      const received = sum(income.filter((e) => e.status === "confirmed")),
        expectedIncome = sum(income),
        expenseTotal = -sum(expenses),
        toPay =
          -sum(
            entries.filter(
              (e) =>
                e.status === "planned" &&
                !e.cardId &&
                ["expense", "refund"].includes(e.kind),
            ),
          ) +
          invoiceList.reduce((a, i) => a + Math.max(i.total - i.paid, 0), 0),
        projectedExpenses = -sum(
          entries.filter((e) => ["expense", "refund"].includes(e.kind)),
        );
      return {
        month,
        profile: { name: profile[0]?.name ?? "", avatarUrl },
        received,
        expectedIncome,
        expenses: expenseTotal,
        toPay,
        projectedSurplus: expectedIncome - projectedExpenses,
        goal: Number(
          goals.find((g) => g.month === first(month))?.amount_cents ?? 0,
        ),
        budget: Number(budget),
        targets: targets.map(({ amount, saved, ...target }) => ({ ...target, amount: Number(amount), saved: Number(saved) })),
        valuations: valuations.map(({ date, value }) => ({ date, value: Number(value) })),
        saved: -sum(confirmed.filter((e) => e.kind === "saving")),
        cashIn: sum(confirmed.filter((e) => !!e.accountId && e.amount > 0)),
        cashOut: -sum(confirmed.filter((e) => !!e.accountId && e.amount < 0)),
        invested: investments.reduce((a, x) => a + Number(x.value_cents), 0),
        recent: confirmed.slice(0, 8),
        upcoming: entries.filter((e) => e.status === "planned"),
        // Card installments belong to the month of their invoice, not of the purchase date.
        installments: [...entries.filter((e) => !e.cardId), ...invoiceEntries].filter(
          (e) => (e.installmentCount ?? 0) > 1 && ["expense", "refund"].includes(e.kind),
        ),
        trend: trend.map((x) => ({
          month: x.month,
          income: Number(x.income),
          expenses: Number(x.expenses),
        })),
        categories: Array.from(categoryMap, ([name, amount]) => ({
          name,
          amount,
        })),
        accounts: accounts.map((x) => ({ id: x.id, name: x.name })),
        cards: cards.map((x) => ({
          id: x.id,
          name: x.name,
          dueDay: x.due_day,
          closingDay: x.closing_day ?? null,
          design: x.design ?? undefined,
          accountId: x.account_id ?? undefined,
          archived: x.archived === true,
        })),
        investments: investments.map((x) => ({
          id: x.id,
          name: x.name,
          institution: x.institution ?? "",
          contributed: Number(x.contributed_cents),
          value: Number(x.value_cents),
          updatedOn: x.as_of,
        })),
        recurrences: rules.map((r: any) => ({
          id: r.id,
          description: r.description,
          amount: Number(r.amount_cents),
          kind: r.kind,
          category: r.category,
          startMonth: r.starts_on.slice(0, 7),
          day: r.day_of_month,
          endMonth: r.ends_on?.slice(0, 7),
        })),
        invoices: invoiceList,
        coverage: batches
          .filter((x) => x.coverage_start && x.coverage_end)
          .map((x) => ({ month, from: x.coverage_start, to: x.coverage_end })),
      };
    },
  };
}
