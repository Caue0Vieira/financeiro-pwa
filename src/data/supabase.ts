import { createClient } from "@supabase/supabase-js";
import { encodeAvatar } from "./avatar";
import type {
  FinanceService,
  Entry,
  Dashboard,
  Action,
  Session,
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
  return {
    session,
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
        case "saveCard":
          await upsert("cards", {
            ...action.card,
            due_day: action.card.dueDay,
            closing_day: action.card.dueDay,
            dueDay: undefined,
          });
          break;
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
    async dashboard(month): Promise<Dashboard> {
      const { data, error } = await db.rpc("monthly_dashboard", {
        p_month: first(month),
      });
      fail(error);
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
        const last = new Date(`${monthEnd(month)}T00:00:00Z`);
        last.setUTCDate(0);
        return {
          cardId: c.id,
          month,
          dueDate: `${month.slice(0, 7)}-${String(Math.min(c.due_day, last.getUTCDate())).padStart(2, "0")}`,
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
        saved: -sum(confirmed.filter((e) => e.kind === "saving")),
        cashIn: sum(confirmed.filter((e) => !!e.accountId && e.amount > 0)),
        cashOut: -sum(confirmed.filter((e) => !!e.accountId && e.amount < 0)),
        invested: investments.reduce((a, x) => a + Number(x.value_cents), 0),
        recent: confirmed.slice(0, 8),
        upcoming: entries.filter((e) => e.status === "planned").slice(0, 8),
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
