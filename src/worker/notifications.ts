import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushPreferences } from "../contracts.ts";
import { addDays, shiftMonth } from "../date.ts";
import { chargeDate } from "../recurring.ts";
import {
  billsDueTomorrow, budgetAlerts, composeNotices, dueKinds, invoicesClosing, knownPushService, largeExpenses,
  normalizePreferences, preferenceOf, subscriptionItems, wants, type Notice, type NoticeItem, type NoticeKind,
} from "../notices.ts";
import { sendPush, type PushResult, type VapidKeys } from "./webpush.ts";
import { monthOnly } from "../summary.ts";
import { detectSubscriptions, lookbackDays, type ChargeGroup } from "../subscriptions.ts";

/**
 * Sends the push notices (cron and webhook). Everything is loaded for all subscribed users at
 * once, a few queries per kind, so a run stays inside the Workers free plan's 50 subrequests;
 * pushes that don't fit wait for the next run because only what was delivered is logged.
 */

export class BudgetExceeded extends Error {}

/** Counts subrequests (Supabase and push services) and refuses past the limit. */
export class SubrequestBudget {
  used = 0;
  readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  get left() {
    return this.limit - this.used;
  }
  readonly fetch: typeof fetch = (input, init) => {
    if (this.used >= this.limit) return Promise.reject(new BudgetExceeded("subrequest budget"));
    this.used++;
    return fetch(input, init);
  };
}

/** Date and hour in São Paulo for an instant. */
export function saoPauloClock(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export type SubscriptionRow = {
  id: string; user_id: string; endpoint: string; p256dh: string; auth: string; preferences: unknown;
};
type Device = SubscriptionRow & { prefs: PushPreferences };
export type Delivery = { device: Device; notice: Notice };

const sentKey = (userId: string, kind: string, ref: string) => `${userId}\u0000${kind}\u0000${ref}`;

/** Which notifications each device gets: its user's items not sent yet that it wants. */
export function planDeliveries(devices: Device[], items: Map<string, NoticeItem[]>, sent: Set<string>): Delivery[] {
  return devices.flatMap((device) => {
    const pending = (items.get(device.user_id) ?? [])
      .filter((item) => !sent.has(sentKey(device.user_id, item.kind, item.ref)) && wants(device.prefs, item));
    return composeNotices(pending).map((notice) => ({ device, notice }));
  });
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const first = (month: string) => `${month}-01`;

/** The items of each kind for these users (only the kinds asked for). */
export async function loadItems(db: SupabaseClient, devices: Device[], kinds: NoticeKind[], now: Date) {
  const users = [...new Set(devices.map(({ user_id }) => user_id))];
  const today = saoPauloClock(now).date;
  const month = today.slice(0, 7);
  const items = new Map<string, NoticeItem[]>();
  const add = (userId: string, list: NoticeItem[]) => {
    if (list.length) items.set(userId, [...(items.get(userId) ?? []), ...list]);
  };
  const byUser = <T extends { user_id: string }>(rows: T[] | null) => {
    const groups = new Map<string, T[]>();
    for (const row of rows ?? []) groups.set(row.user_id, [...(groups.get(row.user_id) ?? []), row]);
    return groups;
  };
  const usersWanting = (kind: NoticeKind) =>
    [...new Set(devices.filter(({ prefs }) => prefs[preferenceOf[kind]]).map(({ user_id }) => user_id))];

  if (kinds.includes("bill_due") && usersWanting("bill_due").length) {
    const wanting = usersWanting("bill_due");
    const tomorrow = addDays(today, 1);
    const billMonth = tomorrow.slice(0, 7);
    const [planned, rules] = await Promise.all([
      db.from("transactions").select("id, user_id, description, amount_cents, occurred_on")
        .in("user_id", wanting).eq("status", "planned").eq("occurred_on", tomorrow).is("card_id", null).eq("kind", "expense").limit(200),
      db.from("recurring_rules").select("id, user_id, description, amount_cents, day_of_month, starts_on, ends_on")
        .in("user_id", wanting).is("card_id", null).eq("kind", "expense").lte("starts_on", tomorrow)
        .or(`ends_on.is.null,ends_on.gte.${first(billMonth)}`).limit(500),
    ]);
    fail(planned.error);
    fail(rules.error);
    const candidates = (rules.data ?? []).filter((rule) =>
      chargeDate({ startMonth: rule.starts_on, endMonth: rule.ends_on ?? undefined, day: rule.day_of_month }, billMonth) === tomorrow);
    const recorded = new Set<string>();
    if (candidates.length) {
      const rows = await db.from("transactions").select("recurring_rule_id")
        .in("recurring_rule_id", candidates.map(({ id }) => id))
        .gte("occurred_on", first(billMonth)).lt("occurred_on", first(shiftMonth(billMonth, 1)));
      fail(rows.error);
      for (const row of rows.data ?? []) recorded.add(`${row.recurring_rule_id}:${billMonth}`);
    }
    const plannedByUser = byUser(planned.data);
    const rulesByUser = byUser(candidates);
    for (const userId of wanting) {
      add(userId, billsDueTomorrow(
        today,
        (plannedByUser.get(userId) ?? []).map((row) => ({
          id: row.id, description: row.description, amount: Number(row.amount_cents), date: row.occurred_on,
        })),
        (rulesByUser.get(userId) ?? []).map((rule) => ({
          id: rule.id, description: rule.description, amount: Number(rule.amount_cents), day: rule.day_of_month,
          startMonth: rule.starts_on, endMonth: rule.ends_on ?? undefined,
        })),
        recorded,
      ));
    }
  }

  if (kinds.includes("invoice_closing") && usersWanting("invoice_closing").length) {
    const wanting = usersWanting("invoice_closing");
    const cards = await db.from("cards").select("id, user_id, name, closing_day, due_day, bill_balance_cents")
      .in("user_id", wanting).eq("archived", false).not("closing_day", "is", null);
    fail(cards.error);
    if (cards.data?.length) {
      const target = addDays(today, 2).slice(0, 7);
      const overrides = await db.from("card_invoice_dates").select("card_id, month, closing_on, due_on")
        .in("user_id", wanting).in("month", [first(target), first(shiftMonth(target, 1))]);
      // Without the invoice dates migration the cards' usual days still apply.
      const adjusted = (overrides.error ? [] : overrides.data ?? []).map((row) => ({
        cardId: row.card_id, month: String(row.month).slice(0, 7), closingDate: row.closing_on, dueDate: row.due_on,
      }));
      for (const [userId, rows] of byUser(cards.data)) {
        add(userId, invoicesClosing(today, rows.map((row) => ({
          id: row.id, name: row.name, closingDay: row.closing_day, dueDay: row.due_day,
          billBalance: row.bill_balance_cents == null ? undefined : Number(row.bill_balance_cents),
        })), adjusted));
      }
    }
  }

  if (kinds.includes("large_expense") && usersWanting("large_expense").length) {
    const wanting = usersWanting("large_expense");
    const min = Math.min(...devices.filter(({ prefs }) => prefs.largeExpense).map(({ prefs }) => prefs.largeExpenseMin));
    const rows = await db.from("transactions").select("id, user_id, description, amount_cents, occurred_on")
      .in("user_id", wanting).eq("source", "pluggy").eq("kind", "expense").lte("amount_cents", -min)
      .gte("created_at", new Date(now.getTime() - 26 * 3_600_000).toISOString())
      .order("amount_cents").limit(100);
    fail(rows.error);
    for (const [userId, list] of byUser(rows.data)) {
      add(userId, largeExpenses(list.map((row) => ({
        id: row.id, description: row.description, amount: Number(row.amount_cents), date: row.occurred_on,
      })), min));
    }
  }

  if (kinds.includes("monthly_summary") && usersWanting("monthly_summary").length) {
    // Summaries of last month created in the last three days (generated on day 1).
    const last = shiftMonth(month, -1);
    const rows = await db.from("monthly_summaries").select("user_id, month")
      .in("user_id", usersWanting("monthly_summary")).eq("month", first(last))
      .gte("created_at", new Date(now.getTime() - 3 * 86_400_000).toISOString());
    fail(rows.error);
    for (const row of rows.data ?? []) {
      add(row.user_id, [{ kind: "monthly_summary", ref: last, label: monthOnly(last), amount: 0 }]);
    }
  }

  if (kinds.includes("subscription") && usersWanting("subscription").length) {
    const wanting = usersWanting("subscription");
    const [charges, decisions] = await Promise.all([
      db.rpc("subscription_charges", { p_since: addDays(today, -lookbackDays), p_users: wanting }),
      db.from("subscription_decisions").select("user_id, merchant_key, status").in("user_id", wanting),
    ]);
    fail(charges.error);
    fail(decisions.error);
    const groupsByUser = byUser(charges.data as (ChargeGroup & { user_id: string })[]);
    const decisionsByUser = byUser(decisions.data);
    for (const userId of wanting) {
      const decided = new Map((decisionsByUser.get(userId) ?? []).map((row) => [row.merchant_key, row.status]));
      add(userId, subscriptionItems(detectSubscriptions(groupsByUser.get(userId) ?? [], decided, today), today));
    }
  }

  if (kinds.includes("budget") && usersWanting("budget").length) {
    const wanting = usersWanting("budget");
    const [limits, monthly] = await Promise.all([
      db.from("category_budgets").select("user_id, category, amount_cents").in("user_id", wanting),
      db.from("monthly_budgets").select("user_id, amount_cents").in("user_id", wanting).eq("month", first(month)),
    ]);
    fail(limits.error);
    fail(monthly.error);
    const limited = [...new Set([...(limits.data ?? []), ...(monthly.data ?? [])].map(({ user_id }) => user_id))];
    if (limited.length) {
      const spending = await db.rpc("notification_spending", { p_month: first(month), p_users: limited });
      fail(spending.error);
      const spentByUser = byUser(spending.data as { user_id: string; category: string; spent: number }[]);
      const limitsByUser = byUser(limits.data);
      for (const userId of limited) {
        add(userId, budgetAlerts(
          month,
          (spentByUser.get(userId) ?? []).map((row) => ({ category: row.category, spent: Number(row.spent) })),
          (limitsByUser.get(userId) ?? []).map((row) => ({ category: row.category, amount: Number(row.amount_cents) })),
          Number(monthly.data?.find((row) => row.user_id === userId)?.amount_cents ?? 0),
        ));
      }
    }
  }
  return items;
}

/** Writes left for after the pushes: the log, gone subscriptions and the last-sent time. */
const reserve = 3;

/**
 * One pass: loads subscriptions, the items of the kinds due at this hour, sends what wasn't sent
 * and logs it. `userId`/`kinds` narrow it (the webhook asks only for one user's large expenses).
 * `idle` means no device is subscribed (one subrequest spent), so the caller can do other work.
 */
export async function runNotices(
  db: SupabaseClient,
  budget: SubrequestBudget,
  keys: VapidKeys,
  options: { now?: Date; userId?: string; kinds?: NoticeKind[] } = {},
) {
  const now = options.now ?? new Date();
  const { hour } = saoPauloClock(now);
  const kinds = dueKinds(hour).filter((kind) => !options.kinds || options.kinds.includes(kind));
  let query = db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, preferences").limit(500);
  if (options.userId) query = query.eq("user_id", options.userId);
  const subscriptions = await query;
  fail(subscriptions.error);
  const devices: Device[] = (subscriptions.data as SubscriptionRow[] ?? [])
    .filter(({ endpoint }) => knownPushService(endpoint))
    .map((row) => ({ ...row, prefs: normalizePreferences(row.preferences) }));
  const result = { idle: devices.length === 0, sent: 0, gone: 0, pending: 0 };
  if (!devices.length || !kinds.length) return result;

  const users = [...new Set(devices.map(({ user_id }) => user_id))];
  const [items, log] = await Promise.all([
    loadItems(db, devices, kinds, now),
    db.from("notification_log").select("user_id, kind, ref").in("user_id", users).in("kind", kinds)
      .gte("sent_at", new Date(now.getTime() - 62 * 86_400_000).toISOString()).limit(5000),
  ]);
  fail(log.error);
  const sent = new Set((log.data ?? []).map((row) => sentKey(row.user_id, row.kind, row.ref)));
  const deliveries = planDeliveries(devices, items, sent);

  const delivered = new Map<string, { user_id: string; kind: string; ref: string }>();
  const gone = new Set<string>();
  const reached = new Set<string>();
  for (const { device, notice } of deliveries) {
    if (gone.has(device.id)) continue;
    if (budget.left <= reserve) {
      result.pending++;
      continue;
    }
    const { kind, refs, ...message } = notice;
    let response: PushResult;
    try {
      response = await sendPush(device, message, keys, budget.fetch);
    } catch (error) {
      console.error("push send", device.id, error);
      continue;
    }
    if (response.gone) gone.add(device.id);
    if (!response.ok) {
      if (!response.gone) console.error("push send", device.id, response.status);
      continue;
    }
    result.sent++;
    reached.add(device.id);
    for (const ref of refs) delivered.set(sentKey(device.user_id, kind, ref), { user_id: device.user_id, kind, ref });
  }
  result.gone = gone.size;
  if (delivered.size) {
    const { error } = await db.from("notification_log").upsert([...delivered.values()], { ignoreDuplicates: true });
    if (error) console.error("notification log", error.message);
  }
  if (gone.size) {
    const { error } = await db.from("push_subscriptions").delete().in("id", [...gone]);
    if (error) console.error("push cleanup", error.message);
  }
  if (reached.size) {
    const { error } = await db.from("push_subscriptions").update({ last_sent_at: now.toISOString() }).in("id", [...reached]);
    if (error) console.error("push last sent", error.message);
  }
  return result;
}

/** Old log rows are no longer needed to avoid repeats (dates and months have passed). */
export async function pruneLog(db: SupabaseClient, now = new Date()) {
  const { error } = await db.from("notification_log").delete().lt("sent_at", new Date(now.getTime() - 120 * 86_400_000).toISOString());
  if (error) console.error("notification log prune", error.message);
}
