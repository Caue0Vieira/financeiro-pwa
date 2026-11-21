import { createClient } from "@supabase/supabase-js";
import { encodeAvatar } from "./avatar";
import { prepareReceipt } from "./receiptFile";
import { filterText, normalizeTags, tagTotals } from "../search";
import { addDays, currentMonth, invoiceDates, shiftMonth, todayInSaoPaulo } from "../date";
import { spendingWindow, summarizeSpending } from "./spending";
import { chargeDate, chargeInvoiceMonth, chargesInInvoice, type CardDays } from "../recurring";
import { normalizePreferences } from "../notices";
import { summaryFrom } from "../summary";
import { projectBalance } from "../forecast";
import { detectSubscriptions, lookbackDays, type ChargeGroup } from "../subscriptions";
import type {
  Assistant,
  BankConnections,
  FinanceService,
  Entry,
  Dashboard,
  Action,
  PushNotifications,
  Summaries,
  MonthlySummary,
  SubscriptionDetector,
  Receipts,
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
  tags: r.tags ?? [],
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
    const response = await fetch(path.startsWith("/") ? path : `/api/pluggy/${path}`, {
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
    /** One request per connection: a single Worker invocation can't import several banks at once. */
    async sync() {
      let inserted = 0;
      const failed: string[] = [];
      for (const { itemId, bank } of await bankConnections.list()) {
        try {
          inserted += (await api<{ inserted: number }>(`items/${encodeURIComponent(itemId)}/sync`)).inserted;
        } catch (error) {
          failed.push(`${bank}: ${error instanceof Error ? error.message : "erro"}`);
        }
      }
      if (failed.length) {
        throw new Error(`${inserted} lançamento(s) novo(s). Não foi possível sincronizar ${failed.join("; ")}`);
      }
      return { inserted };
    },
    remove: (itemId) => api<void>(`items/${encodeURIComponent(itemId)}`, "DELETE"),
  };
  /** Streams the Worker's /api/chat answer (plain text) into `onText`. */
  const assistant: Assistant = {
    async ask(question, context, history, onText) {
      const { data } = await db.auth.getSession();
      if (!data.session) throw new Error("Sessão encerrada");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ question, context, history }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "O assistente não respondeu. Tente de novo.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += value;
        onText(value);
      }
      return answer;
    },
  };
  /** Each device writes its own subscription (RLS); the Worker sends from the cron. */
  const push: PushNotifications = {
    async publicKey() {
      const response = await fetch("/api/push/key").catch(() => null);
      if (!response?.ok) return null;
      const { publicKey } = await response.json().catch(() => ({}));
      return typeof publicKey === "string" && publicKey ? publicKey : null;
    },
    async preferences(endpoint) {
      const { data, error } = await db.from("push_subscriptions").select("preferences").eq("endpoint", endpoint).maybeSingle();
      fail(error);
      return data ? normalizePreferences(data.preferences) : null;
    },
    async save({ endpoint, p256dh, auth }, preferences) {
      const { error } = await db.from("push_subscriptions").upsert(
        { endpoint, p256dh, auth, preferences, user_agent: navigator.userAgent.slice(0, 300) },
        { onConflict: "endpoint" },
      );
      fail(error);
    },
    async remove(endpoint) {
      const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
      fail(error);
    },
    test: (endpoint) => api<void>("/api/push/test", "POST", { endpoint }),
  };
  /**
   * Stores the forecast's negative day for the push notice (the cron reads it). Written only when
   * it changes, not on every refresh; failures are ignored (the screen already shows the alert).
   */
  let storedForecast = "";
  const rememberForecast = async (forecast: NonNullable<Dashboard["forecast"]>) => {
    const row = { month: first(currentMonth()), negative_on: forecast.negativeOn, lowest_cents: forecast.lowest.balance };
    const key = JSON.stringify(row);
    if (key === storedForecast) return;
    storedForecast = key;
    const { error } = await db.from("balance_forecasts").upsert({ ...row, updated_at: new Date().toISOString() });
    if (error) storedForecast = "";
  };
  const summaryColumns = "month, numbers, text, dismissed_at";
  const summaries: Summaries = {
    async list() {
      const { data, error } = await db.from("monthly_summaries").select(summaryColumns).order("month", { ascending: false }).limit(24);
      fail(error);
      return (data ?? []).map(summaryFrom);
    },
    async dismiss(month) {
      const { error } = await db.from("monthly_summaries").update({ dismissed_at: new Date().toISOString() }).eq("month", first(month));
      fail(error);
    },
    generate: () => api<{ summary: MonthlySummary | null }>("/api/summary").then((result) => result.summary),
  };
  const subscriptions: SubscriptionDetector = {
    async list() {
      const today = todayInSaoPaulo();
      const [charges, decisions] = await Promise.all([
        db.rpc("subscription_charges", { p_since: addDays(today, -lookbackDays) }),
        db.from("subscription_decisions").select("merchant_key, status"),
      ]);
      fail(charges.error);
      fail(decisions.error);
      const decided = new Map((decisions.data ?? []).map((row) => [row.merchant_key as string, row.status]));
      return detectSubscriptions((charges.data ?? []) as ChargeGroup[], decided, today);
    },
    async decide(key, status) {
      if (!status) {
        const { error } = await db.from("subscription_decisions").delete().eq("merchant_key", key);
        fail(error);
        return;
      }
      const u = await user();
      const { error } = await db.from("subscription_decisions").upsert(
        { user_id: u.id, merchant_key: key, status, updated_at: new Date().toISOString() },
        { onConflict: "user_id,merchant_key" },
      );
      fail(error);
    },
  };
  /** Files in the private "receipts" bucket under the user's id; links last an hour. */
  type ReceiptRow = { id: string; path: string; thumb_path: string | null; name: string; content_type: string; size_bytes: number; created_at: string };
  const receiptColumns = "id, path, thumb_path, name, content_type, size_bytes, created_at";
  const signed = async (rows: ReceiptRow[]) => {
    if (!rows.length) return [];
    const paths = rows.flatMap((row) => [row.path, ...(row.thumb_path ? [row.thumb_path] : [])]);
    const { data, error } = await db.storage.from("receipts").createSignedUrls(paths, 3600);
    fail(error);
    const link = new Map((data ?? []).map((item) => [item.path, item.signedUrl ?? undefined]));
    return rows.map((row) => ({
      id: row.id, name: row.name, contentType: row.content_type, size: row.size_bytes, createdAt: row.created_at,
      url: link.get(row.path) ?? "", thumbnailUrl: row.thumb_path ? link.get(row.thumb_path) : undefined,
    }));
  };
  const removeReceiptFiles = async (column: "id" | "transaction_id", value: string) => {
    const { data, error } = await db.from("receipts").select("path, thumb_path").eq(column, value);
    // Without the receipts migration there is nothing to remove.
    if (error || !data?.length) return;
    await db.storage.from("receipts").remove(data.flatMap((row) => [row.path, ...(row.thumb_path ? [row.thumb_path] : [])]));
  };
  const receipts: Receipts = {
    async list(entryId) {
      const { data, error } = await db.from("receipts").select(receiptColumns).eq("transaction_id", entryId).order("created_at");
      fail(error);
      return signed((data ?? []) as ReceiptRow[]);
    },
    async add(entryId, file) {
      const u = await user();
      const prepared = await prepareReceipt(file);
      const folder = `${u.id}/${entryId}/${crypto.randomUUID()}`;
      const path = `${folder}.${prepared.contentType === "application/pdf" ? "pdf" : "jpg"}`;
      const thumbPath = prepared.thumb ? `${folder}-miniatura.jpg` : null;
      const uploaded = await db.storage.from("receipts").upload(path, prepared.main, { contentType: prepared.contentType });
      fail(uploaded.error);
      if (prepared.thumb && thumbPath) {
        const thumb = await db.storage.from("receipts").upload(thumbPath, prepared.thumb, { contentType: "image/jpeg" });
        fail(thumb.error);
      }
      const { data, error } = await db.from("receipts").insert({
        transaction_id: entryId, path, thumb_path: thumbPath, name: prepared.name,
        content_type: prepared.contentType, size_bytes: prepared.main.size,
      }).select(receiptColumns).single();
      if (error) {
        await db.storage.from("receipts").remove([path, ...(thumbPath ? [thumbPath] : [])]);
        fail(error);
      }
      return (await signed([data as ReceiptRow]))[0];
    },
    async remove(id) {
      await removeReceiptFiles("id", id);
      const { error } = await db.from("receipts").delete().eq("id", id);
      fail(error);
    },
  };
  return {
    session,
    bankConnections,
    assistant,
    push,
    summaries,
    subscriptions,
    receipts,
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
    async entries(from, to) {
      const rows: Entry[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from("transactions").select("*")
          .gte("occurred_on", from).lte("occurred_on", to).neq("status", "review")
          .order("occurred_on").order("id").range(offset, offset + 999);
        fail(error);
        rows.push(...(data ?? []).map(entry));
        if ((data?.length ?? 0) < 1000) return rows;
      }
    },
    async search(filters, limit = 200) {
      let query = db.from("transactions").select("*").neq("status", "review")
        .order("occurred_on", { ascending: false }).order("id", { ascending: false }).limit(limit);
      const text = filterText(filters.text ?? "");
      if (text) query = query.or(`description.ilike."*${text}*",category.ilike."*${text}*"`);
      // The value range applies to the amount whatever its sign (expenses are negative).
      if (filters.min || filters.max) {
        const min = filters.min ?? 0;
        const max = filters.max ?? 100_000_000_00;
        query = query.or(`and(amount_cents.gte.${min},amount_cents.lte.${max}),and(amount_cents.gte.${-max},amount_cents.lte.${-min})`);
      }
      if (filters.from) query = query.gte("occurred_on", filters.from);
      if (filters.to) query = query.lte("occurred_on", filters.to);
      if (filters.source?.startsWith("card:")) query = query.eq("card_id", filters.source.slice(5));
      if (filters.source?.startsWith("account:")) query = query.eq("account_id", filters.source.slice(8));
      const category = filterText(filters.category ?? "");
      if (category) query = query.ilike("category", category);
      if (filters.tag) query = query.contains("tags", [filters.tag]);
      const { data, error } = await query;
      fail(error);
      return (data ?? []).map(entry);
    },
    async tags() {
      const { data, error } = await db.from("transactions").select("tags").neq("tags", "{}").limit(2000);
      // Until the tags migration is applied there are none.
      if (error) return [];
      return [...new Set((data ?? []).flatMap((row) => row.tags as string[]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
    async confirmImport(payload) {
      const { data, error } = await db.rpc("import_transactions", {
        p_payload: {
          ...payload,
          month: payload.month ? first(payload.month) : null,
        },
      });
      fail(error);
      // Workers AI classifies what arrived as "Sem categoria"; the import does not wait for it.
      if (data?.inserted) void api("/api/categorize").catch(() => undefined);
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
            ...(e.tags !== undefined && { tags: normalizeTags(e.tags) }),
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
          // The rows go with the entry (on delete cascade); the files in storage are removed here.
          await removeReceiptFiles("transaction_id", action.id);
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
        case "saveCategoryBudget": {
          const category = action.category.trim();
          if (action.amount > 0) {
            const u = await user();
            const { error } = await db.from("category_budgets").upsert(
              { user_id: u.id, category, amount_cents: action.amount },
              { onConflict: "user_id,category" },
            );
            fail(error);
          } else {
            const { error } = await db.from("category_budgets").delete().eq("category", category);
            fail(error);
          }
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
      const [{ data, error }, tagged] = await Promise.all([
        db.rpc("nitido_expense_days", { p_start: window.previous, p_end: window.end }),
        db.from("transactions").select("kind, amount_cents, tags")
          .gte("occurred_on", window.start).lt("occurred_on", window.end).eq("status", "confirmed")
          .in("kind", ["expense", "refund"]).neq("tags", "{}").limit(5000),
      ]);
      fail(error);
      const rows = (data as { date: string; category: string; amount: number }[]).map(
        (row) => ({ ...row, amount: Number(row.amount) }),
      );
      return {
        ...summarizeSpending(rows, window, period),
        // Without the tags migration the query fails and there is no tag section.
        tags: tagged.error ? [] : tagTotals((tagged.data ?? []).map((row) => ({ kind: row.kind, amount: Number(row.amount_cents), tags: row.tags }))),
      };
    },
    async dashboard(month): Promise<Dashboard> {
      const [{ data, error }, planning, adjustedDates, categoryLimits, lastSummary, bankAccounts] = await Promise.all([
        db.rpc("monthly_dashboard", { p_month: first(month) }),
        db.rpc("nitido_planning", { p_month: first(month) }),
        db.from("card_invoice_dates").select("card_id, closing_on, due_on").eq("month", first(month)),
        db.from("category_budgets").select("category, amount_cents").order("category"),
        db.from("monthly_summaries").select(summaryColumns)
          .eq("month", first(shiftMonth(currentMonth(), -1))).is("dismissed_at", null).maybeSingle(),
        db.from("pluggy_accounts").select("balance_cents").not("account_id", "is", null),
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
        recurring_rows,
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
        | "recurring_rows"
        | "rows"
        | "invoice_rows"
        | "invoices"
        | "payments"
        | "trend",
        any[]
      >;
      const entries: Entry[] = rows.map(entry);
      const period = month.slice(0, 7);
      const cardDays = new Map<string, CardDays>(
        cards.map((c: any) => [c.id, { closingDay: c.closing_day ?? null, dueDay: c.due_day ?? null }]),
      );
      // Charges already recorded as transactions, by rule and month; the RPC adds the two months before.
      const recorded = new Set([
        ...entries.filter((e) => e.recurrenceId).map((e) => `${e.recurrenceId}:${e.date.slice(0, 7)}`),
        ...(recurring_rows ?? []).map((x: any) => `${x.recurring_rule_id}:${String(x.occurred_on).slice(0, 7)}`),
      ]);
      const ruleCharge = (r: any, date: string): Entry => ({
        id: `recurrence:${r.id}:${date.slice(0, 7)}`,
        date,
        description: r.description,
        amount: Number(r.amount_cents),
        kind: r.kind,
        category: r.category,
        status: "planned",
        source: "recurrence",
        recurrenceId: r.id,
        // Charged on a card: billed in the invoice its date falls into, by the card's closing day.
        ...(r.card_id ? { cardId: r.card_id, invoiceMonth: chargeInvoiceMonth(date, cardDays.get(r.card_id)) } : {}),
      });
      // Card charges from earlier months (after their closing day) that are billed in this month's invoice.
      const earlierCardCharges: Entry[] = [];
      for (const r of rules) {
        const rule = { startMonth: r.starts_on, endMonth: r.ends_on ?? undefined, day: r.day_of_month };
        const date = chargeDate(rule, period);
        if (date && !recorded.has(`${r.id}:${period}`)) entries.push(ruleCharge(r, date));
        if (!r.card_id) continue;
        for (const earlier of chargesInInvoice(rule, cardDays.get(r.card_id), period)) {
          if (earlier.slice(0, 7) < period && !recorded.has(`${r.id}:${earlier.slice(0, 7)}`)) {
            earlierCardCharges.push(ruleCharge(r, earlier));
          }
        }
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
      // Card charges of recurring rules not recorded yet still count in the invoice they are billed in.
      const invoiceEntries: Entry[] = [
        ...invoice_rows.map(entry),
        ...entries.filter((e) => e.cardId && e.id.startsWith("recurrence:") && e.invoiceMonth === period),
        ...earlierCardCharges,
      ];
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
      // Balance forecast (current month only), from the bank balances Open Finance brought.
      const balances = (bankAccounts.error ? [] : bankAccounts.data ?? [])
        .filter((x) => x.balance_cents != null).map((x) => Number(x.balance_cents));
      const forecast = month.slice(0, 7) === currentMonth()
        ? projectBalance({
          today: todayInSaoPaulo(),
          entries,
          invoices: invoiceList,
          bankBalance: balances.length ? balances.reduce((a, b) => a + b, 0) : undefined,
        })
        : null;
      if (forecast) void rememberForecast(forecast);
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
          ...(x.credit_limit_cents != null && { creditLimit: Number(x.credit_limit_cents) }),
          ...(x.available_limit_cents != null && { availableLimit: Number(x.available_limit_cents) }),
          ...(x.bill_balance_cents != null && { billBalance: Number(x.bill_balance_cents) }),
          ...(x.limits_synced_at && { limitsUpdatedAt: x.limits_synced_at }),
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
          cardId: r.card_id ?? undefined,
        })),
        invoices: invoiceList,
        // Until the push_notifications migration is applied there are no category limits.
        categoryBudgets: (categoryLimits.error ? [] : categoryLimits.data ?? []).map((x) => ({
          category: x.category, amount: Number(x.amount_cents),
        })),
        // Until the monthly_summaries migration is applied there is no summary card.
        summary: lastSummary.error || !lastSummary.data ? null : summaryFrom(lastSummary.data),
        forecast,
        coverage: batches
          .filter((x) => x.coverage_start && x.coverage_end)
          .map((x) => ({ month, from: x.coverage_start, to: x.coverage_end })),
      };
    },
  };
}
