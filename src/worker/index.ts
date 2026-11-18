import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inferCategory } from "../frontend/merchants";
import manifestSource from "../../public/manifest.webmanifest?raw";
import { manifestFor } from "./manifest";
import { mapTransaction, purchasesAreNegative } from "./mapping";
import { PluggyError, pluggyClient, tokenHeader, validSignature, validToken, type Pluggy } from "./pluggy";
import { deleteTransactions, syncItem } from "./sync";

/**
 * Server side of the Pluggy (Open Finance) integration. Runs only for /api/* (see
 * cloudflare.config.ts); everything else is served as static assets. Secrets never reach the
 * browser: the app calls these routes with the user's Supabase session token.
 */
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PLUGGY_CLIENT_ID: string;
  PLUGGY_CLIENT_SECRET: string;
  PLUGGY_WEBHOOK_SECRET: string;
};
type Context = { waitUntil(promise: Promise<unknown>): void };
type Services = { env: Env; db: SupabaseClient; pluggy: Pluggy };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function signedInUser({ db }: Services, request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Entre na sua conta para continuar.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sessão expirada. Entre novamente.");
  return data.user.id;
}

async function ownedItem({ db }: Services, userId: string, itemId: unknown) {
  if (typeof itemId !== "string" || !itemId) throw new HttpError(400, "Conexão inválida.");
  const { data, error } = await db.from("pluggy_items").select("item_id").eq("item_id", itemId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Conexão não encontrada.");
  return itemId;
}

const body = async (request: Request) => (await request.json().catch(() => ({}))) as Record<string, unknown>;

async function connectToken(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  const { itemId } = await body(request);
  if (itemId !== undefined) await ownedItem(services, userId, itemId);
  return json({ connectToken: await services.pluggy.connectToken(userId, itemId as string | undefined) });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stores an item and imports it. Two origins: Pluggy Connect in the app (the item carries this
 * user's clientUserId) or a connection made in the Pluggy Dashboard, as Meu Pluggy requires
 * (no clientUserId; the id is pasted in the app). Pluggy only returns items of this
 * application, and an item already linked to another user is refused below.
 */
async function registerItem(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  const { itemId } = await body(request);
  if (typeof itemId !== "string" || !uuid.test(itemId.trim())) throw new HttpError(400, "ID de conexão inválido.");
  const item = await services.pluggy.item(itemId.trim()).catch((error) => {
    if (error instanceof PluggyError && (error.status === 404 || error.status === 400)) {
      throw new HttpError(404, "Conexão não encontrada na sua aplicação da Pluggy.");
    }
    throw error;
  });
  if (item.clientUserId && item.clientUserId !== userId) throw new HttpError(403, "Esta conexão não pertence à sua conta.");
  const { data: existing, error } = await services.db.from("pluggy_items").select("user_id").eq("item_id", item.id).maybeSingle();
  if (error) throw error;
  if (existing && existing.user_id !== userId) throw new HttpError(403, "Esta conexão não pertence à sua conta.");
  if (!existing) {
    const saved = await services.db.from("pluggy_items")
      .insert({ user_id: userId, item_id: item.id, connector_name: item.connector.name, status: item.status ?? null });
    if (saved.error) throw saved.error;
  }
  return json(await syncItem(services.db, services.pluggy, userId, item.id, inferCategory));
}

/** "Sincronizar": asks the banks for fresh data (arrives by webhook) and imports what Pluggy has now. */
async function syncAll(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  const { data, error } = await services.db.from("pluggy_items").select("item_id").eq("user_id", userId);
  if (error) throw error;
  let inserted = 0;
  for (const { item_id } of data ?? []) {
    // Meu Pluggy items refuse PATCH (they follow the original connection's daily sync); ignore.
    await services.pluggy.refreshItem(item_id).catch(() => undefined);
    inserted += (await syncItem(services.db, services.pluggy, userId, item_id, inferCategory)).inserted;
  }
  return json({ inserted });
}

async function removeItem(services: Services, request: Request, itemId: string) {
  const userId = await signedInUser(services, request);
  await ownedItem(services, userId, itemId);
  await services.pluggy.deleteItem(itemId).catch((error) => {
    if (!(error instanceof PluggyError && error.status === 404)) throw error;
  });
  // Imported transactions stay; only the connection and its account links go.
  const { error } = await services.db.from("pluggy_items").delete().eq("item_id", itemId).eq("user_id", userId);
  if (error) throw error;
  return json({ ok: true });
}

type WebhookEvent = {
  event: string;
  eventId?: string;
  itemId?: string;
  accountId?: string;
  transactionIds?: string[];
};

/** Re-reads changed transactions and updates date, description and amount (keeps the user's category). */
async function updateTransactions({ db, pluggy }: Services, userId: string, event: WebhookEvent) {
  if (!event.itemId || !event.accountId || !event.transactionIds?.length) return;
  const account = (await pluggy.accounts(event.itemId)).find(({ id }) => id === event.accountId);
  if (!account) return;
  const transactions = await pluggy.transactions(account.id, { ids: event.transactionIds.slice(0, 500) });
  const purchasesNegative = account.type === "CREDIT" && purchasesAreNegative(transactions);
  for (const tx of transactions) {
    const row = mapTransaction(tx, account, { closingDay: null, dueDay: null, purchasesNegative, categorize: () => "" });
    if (!row) continue;
    const { error } = await db.from("transactions")
      .update({ occurred_on: row.occurred_on, description: row.description, amount_cents: row.amount_cents })
      .eq("user_id", userId).eq("source", "pluggy").eq("external_id", row.external_id);
    if (error) throw error;
  }
}

async function webhook(services: Services, request: Request, context: Context) {
  const raw = await request.text();
  const secret = services.env.PLUGGY_WEBHOOK_SECRET ?? "";
  // Either Pluggy's HMAC signature (signing secret) or the custom header token set in the dashboard.
  const authentic = validToken(request.headers.get(tokenHeader), secret)
    || (await validSignature(request.headers.get("x-pluggy-signature"), raw, secret));
  if (!authentic) return json({ error: "unauthorized" }, 401);
  const event = JSON.parse(raw) as WebhookEvent;
  if (event.eventId) {
    const seen = await services.db.from("pluggy_events").insert({ event_id: event.eventId });
    if (seen.error?.code === "23505") return json({ ok: true, duplicate: true });
    if (seen.error) throw seen.error;
  }
  if (!event.itemId) return json({ ok: true });
  const { data: owner, error } = await services.db.from("pluggy_items").select("user_id").eq("item_id", event.itemId).maybeSingle();
  if (error) throw error;
  if (!owner) return json({ ok: true, ignored: true });
  const userId = owner.user_id as string;

  // Pluggy expects a 2xx within 10 s: answer now, work after the response.
  context.waitUntil((async () => {
    switch (event.event) {
      case "item/deleted":
        await services.db.from("pluggy_items").delete().eq("item_id", event.itemId);
        break;
      case "item/error":
      case "item/waiting_user_action":
      case "item/waiting_user_input":
        await services.db.from("pluggy_items").update({ status: event.event.slice(5).toUpperCase() }).eq("item_id", event.itemId);
        break;
      case "transactions/deleted":
        await deleteTransactions(services.db, userId, event.transactionIds ?? []);
        break;
      case "transactions/updated":
        await updateTransactions(services, userId, event);
        break;
      case "item/created":
      case "item/updated":
      case "transactions/created":
        await syncItem(services.db, services.pluggy, userId, event.itemId!, inferCategory);
        break;
    }
    await services.db.from("pluggy_events").delete().lt("received_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  })().catch((error) => console.error("pluggy webhook", event.event, error)));
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env, context: Context): Promise<Response> {
    const { pathname } = new URL(request.url);
    // Needs no secrets, so it works before the Pluggy setup is done.
    if (pathname === "/manifest.webmanifest") {
      return new Response(manifestFor(manifestSource, request.headers.get("cookie")), {
        headers: {
          "content-type": "application/manifest+json; charset=utf-8",
          "cache-control": "no-cache",
          vary: "Cookie",
        },
      });
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET) {
      return json({ error: "Open Finance ainda não configurado no servidor." }, 503);
    }
    try {
      const services: Services = {
        env,
        db: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        pluggy: pluggyClient(env.PLUGGY_CLIENT_ID, env.PLUGGY_CLIENT_SECRET),
      };
      const itemRoute = pathname.match(/^\/api\/pluggy\/items\/([^/]+)$/);
      if (request.method === "POST" && pathname === "/api/pluggy/webhook") return await webhook(services, request, context);
      if (request.method === "POST" && pathname === "/api/pluggy/connect-token") return await connectToken(services, request);
      if (request.method === "POST" && pathname === "/api/pluggy/items") return await registerItem(services, request);
      if (request.method === "POST" && pathname === "/api/pluggy/sync") return await syncAll(services, request);
      if (request.method === "DELETE" && itemRoute) return await removeItem(services, request, decodeURIComponent(itemRoute[1]));
      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(pathname, error);
      const message = error instanceof PluggyError ? error.message : "Não foi possível concluir. Tente de novo.";
      return json({ error: message }, 502);
    }
  },
};
