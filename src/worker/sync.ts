import type { SupabaseClient } from "@supabase/supabase-js";
import { bankNameFor, dayOf, mapTransaction, purchasesAreNegative, type PluggyAccount } from "./mapping";
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

/**
 * Imports the item's posted transactions since `dateFrom` (default: a margin before the last
 * sync, or 90 days on the first one). Rows already imported are skipped by external id.
 * Categories come from the user's learned rules first, then the built-in merchant patterns.
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
    db.from("pluggy_items").select("last_synced_at").eq("item_id", itemId).eq("user_id", userId).single(),
    loadRules(db, userId),
  ]);
  const learned = (description: string) => rules.get(descriptionKey(description));
  const categorize = (description: string) => learned(description) ?? inferCategory(description);
  fail(stored.error);
  const lastSync = stored.data?.last_synced_at as string | null;
  const dateFrom = options.dateFrom ?? (lastSync ? daysAgo(Math.ceil((Date.now() - Date.parse(lastSync)) / 86_400_000) + 10) : daysAgo(90));
  const links = await linkAccounts(db, userId, item, accounts);

  let inserted = 0;
  for (const account of accounts) {
    const link = links.get(account.id)!;
    const target = link.card_id ? { column: "card_id", id: link.card_id } : { column: "account_id", id: link.account_id! };
    const transactions = await pluggy.transactions(account.id, { dateFrom });
    if (!transactions.length) continue;

    let closingDay: number | null = null;
    let dueDay: number | null = null;
    if (link.card_id) {
      const card = await db.from("cards").select("closing_day, due_day").eq("id", link.card_id).single();
      fail(card.error);
      closingDay = card.data!.closing_day;
      dueDay = card.data!.due_day;
    }
    const purchasesNegative = account.type === "CREDIT" && purchasesAreNegative(transactions);
    const rows = transactions
      .map((tx) => mapTransaction(tx, account, { closingDay, dueDay, purchasesNegative, categorize }))
      .filter((row) => row !== null);

    const known = new Set<string>();
    for (let i = 0; i < rows.length; i += 200) {
      const ids = rows.slice(i, i + 200).map((row) => row.external_id);
      const { data, error } = await db.from("transactions").select("external_id")
        .eq("user_id", userId).eq(target.column, target.id).in("external_id", ids);
      fail(error);
      for (const { external_id } of data ?? []) known.add(external_id);
    }
    const fresh = rows.filter((row) => !known.has(row.external_id))
      .map((row) => ({
        ...row,
        user_id: userId,
        [target.column]: target.id,
        category_source: learned(row.description) === row.category ? "rule" : null,
      }));
    for (let i = 0; i < fresh.length; i += 200) {
      const { error } = await db.from("transactions").insert(fresh.slice(i, i + 200));
      fail(error);
    }
    inserted += fresh.length;
  }

  const updated = await db.from("pluggy_items")
    .update({
      last_synced_at: new Date().toISOString(),
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
