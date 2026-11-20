import type { SupabaseClient } from "@supabase/supabase-js";
import { bankNameFor, dayOf, mapTransaction, purchasesAreNegative, saoPauloDate, type PluggyAccount } from "./mapping";
import { inferCategory } from "../frontend/merchants";
import { descriptionKey, loadRules } from "./categorize";
import type { Pluggy, PluggyItem } from "./pluggy";

type Link = { pluggy_account_id: string; account_id: string | null; card_id: string | null };

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** The app account named after the bank (e.g. "Banco Inter"), created when missing. */
async function bankAccount(db: SupabaseClient, userId: string, bankName: string) {
  const { data, error } = await db.from("accounts").select("id, name").eq("user_id", userId);
  fail(error);
  const existing = data?.find(({ name }) => name.trim().toLowerCase() === bankName.trim().toLowerCase());
  if (existing) return existing.id as string;
  const created = await db.from("accounts").insert({ user_id: userId, name: bankName }).select("id").single();
  fail(created.error);
  return created.data!.id as string;
}

/** Links each Pluggy account to an app account (BANK) or card (CREDIT), creating them once. */
async function linkAccounts(db: SupabaseClient, userId: string, item: PluggyItem, accounts: PluggyAccount[]) {
  const { data, error } = await db.from("pluggy_accounts").select("pluggy_account_id, account_id, card_id").eq("item_id", item.id);
  fail(error);
  const links = new Map((data as Link[]).map((link) => [link.pluggy_account_id, link]));
  for (const account of accounts) {
    if (links.has(account.id)) continue;
    const bankId = await bankAccount(db, userId, bankNameFor(item.connector.name, accounts));
    let link: Link;
    if (account.type === "CREDIT") {
      const card = await db.from("cards").insert({
        user_id: userId,
        name: account.marketingName || account.name,
        account_id: bankId,
        closing_day: dayOf(account.creditData?.balanceCloseDate),
        due_day: dayOf(account.creditData?.balanceDueDate),
      }).select("id").single();
      fail(card.error);
      link = { pluggy_account_id: account.id, account_id: null, card_id: card.data!.id };
    } else {
      link = { pluggy_account_id: account.id, account_id: bankId, card_id: null };
    }
    const saved = await db.from("pluggy_accounts").insert({ ...link, user_id: userId, item_id: item.id });
    fail(saved.error);
    links.set(account.id, link);
  }
  return links;
}

/** Categories the app chose by itself; rows with any other category were set by the user. */
const automaticCategories = new Set(["Sem categoria", "Transferências", "Investimentos", "Receitas"]);
/** Pluggy keeps about 12 months of history. */
const historyDays = 365;
const cents = (value: number | null | undefined) => (typeof value === "number" ? Math.round(value * 100) : null);

/**
 * Imports the item's transactions since `dateFrom` (default: a margin before the last sync, or
 * 12 months the first time an item is synced). Rows already imported are skipped by external id,
 * except that transfers between the user's own accounts, savings-pot moves and yields that an
 * older version recorded as expense or income are corrected (unless the user chose a category).
 * Categories come from the user's learned rules first, then the built-in merchant patterns.
 * Card limits and the open invoice balance are copied to the card.
 */
export async function syncItem(
  db: SupabaseClient,
  pluggy: Pluggy,
  userId: string,
  itemId: string,
  options: { dateFrom?: string } = {},
) {
  const [item, accounts, stored, rules] = await Promise.all([
    pluggy.item(itemId),
    pluggy.accounts(itemId),
    db.from("pluggy_items").select("last_synced_at, history_synced_at").eq("item_id", itemId).eq("user_id", userId).single(),
    loadRules(db, userId),
  ]);
  const learned = (description: string) => rules.get(descriptionKey(description));
  const categorize = (description: string) => learned(description) ?? inferCategory(description);
  fail(stored.error);
  const lastSync = stored.data?.last_synced_at as string | null;
  const fullHistory = !stored.data?.history_synced_at;
  const dateFrom = options.dateFrom ?? (fullHistory || !lastSync
    ? daysAgo(historyDays)
    : daysAgo(Math.ceil((Date.now() - Date.parse(lastSync)) / 86_400_000) + 10));
  const links = await linkAccounts(db, userId, item, accounts);
  const today = saoPauloDate(new Date().toISOString());

  let inserted = 0;
  for (const account of accounts) {
    const link = links.get(account.id)!;
    const target = link.card_id ? { column: "card_id", id: link.card_id } : { column: "account_id", id: link.account_id! };
    // Few round trips per account: the Workers free plan allows 50 subrequests per invocation.
    let closingDay: number | null = null;
    let dueDay: number | null = null;
    if (link.card_id) {
      const card = await db.from("cards").update({
        bill_balance_cents: cents(account.balance),
        credit_limit_cents: cents(account.creditData?.creditLimit),
        available_limit_cents: cents(account.creditData?.availableCreditLimit),
        limits_synced_at: new Date().toISOString(),
      }).eq("id", link.card_id).eq("user_id", userId).select("closing_day, due_day").single();
      fail(card.error);
      closingDay = card.data!.closing_day;
      dueDay = card.data!.due_day;
    }
    const transactions = await pluggy.transactions(account.id, { dateFrom });
    if (!transactions.length) continue;

    const purchasesNegative = account.type === "CREDIT" && purchasesAreNegative(transactions);
    const rows = transactions
      .map((tx) => mapTransaction(tx, account, { closingDay, dueDay, purchasesNegative, categorize, today }))
      .filter((row) => row !== null);

    // Everything this account already imported in the window (dates in São Paulo can be a day
    // before Pluggy's UTC date, hence the margin).
    const known = new Map<string, { kind: string; category: string }>();
    const since = new Date(Date.parse(dateFrom) - 3 * 86_400_000).toISOString().slice(0, 10);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("transactions").select("external_id, kind, category")
        .eq("user_id", userId).eq(target.column, target.id).eq("source", "pluggy").gte("occurred_on", since)
        .order("id").range(from, from + 999);
      fail(error);
      for (const { external_id, kind, category } of data ?? []) known.set(external_id, { kind, category });
      if ((data?.length ?? 0) < 1000) break;
    }

    const corrections = new Map<string, string[]>();
    for (const row of rows) {
      const old = known.get(row.external_id);
      if (!old || !(row.kind === "transfer" || row.category === "Rendimentos")) continue;
      if ((old.kind === row.kind && old.category === row.category) || !automaticCategories.has(old.category)) continue;
      const key = `${row.kind}\u0000${row.category}`;
      corrections.set(key, [...(corrections.get(key) ?? []), row.external_id]);
    }
    for (const [key, ids] of corrections) {
      const [kind, category] = key.split("\u0000");
      const { error } = await db.from("transactions").update({ kind, category })
        .eq("user_id", userId).eq(target.column, target.id).eq("source", "pluggy").in("external_id", ids);
      fail(error);
    }

    const fresh = rows.filter((row) => !known.has(row.external_id))
      .map((row) => ({
        ...row,
        user_id: userId,
        [target.column]: target.id,
        category_source: learned(row.description) === row.category ? "rule" : null,
      }));
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await db.from("transactions").insert(fresh.slice(i, i + 500));
      fail(error);
    }
    inserted += fresh.length;
  }

  const updated = await db.from("pluggy_items")
    .update({
      last_synced_at: new Date().toISOString(),
      ...(fullHistory && !options.dateFrom && { history_synced_at: new Date().toISOString() }),
      status: item.status ?? null,
      connector_name: bankNameFor(item.connector.name, accounts),
    })
    .eq("item_id", itemId).eq("user_id", userId);
  fail(updated.error);
  return { inserted };
}

/** Removes transactions Pluggy reported as deleted (webhook transactions/deleted). */
export async function deleteTransactions(db: SupabaseClient, userId: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await db.from("transactions").delete()
    .eq("user_id", userId).eq("source", "pluggy").in("external_id", ids);
  fail(error);
}
