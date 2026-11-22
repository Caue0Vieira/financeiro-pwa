import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import manifestSource from "../../public/manifest.webmanifest?raw";
import { answer, ChatInputError, quotaExceeded } from "./assistant";
import { categorizeEveryone, categorizePending, type Ai } from "./categorize";
import { manifestFor } from "./manifest";
import { mapTransaction, purchasesAreNegative } from "./mapping";
import { PluggyError, pluggyClient, tokenHeader, validSignature, validToken, type Pluggy } from "./pluggy";
import { deleteTransactions, syncItem } from "./sync";
import { hashToken, newToken, open as openSecret, seal as sealSecret, validKey } from "./credentials";
import { pruneLog, runNotices, saoPauloClock, SubrequestBudget } from "./notifications";
import { generateSummaries } from "./summaries";
import { summaryFrom } from "../summary";
import { shiftMonth } from "../date";
import { knownPushService } from "../notices";
import { sendPush, type VapidKeys } from "./webpush";

/**
 * Server side of the Pluggy (Open Finance) integration. Runs only for /api/* (see
 * cloudflare.config.ts); everything else is served as static assets. Secrets never reach the
 * browser: the app calls these routes with the user's Supabase session token.
 */
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** The server's Pluggy application (optional: each user may register their own instead). */
  PLUGGY_CLIENT_ID?: string;
  PLUGGY_CLIENT_SECRET?: string;
  PLUGGY_WEBHOOK_SECRET?: string;
  /** 32 random bytes (hex) sealing each user's own Pluggy client secret (see credentials.ts). */
  PLUGGY_CREDENTIALS_KEY?: string;
  /** Workers AI: classifies what no learned rule or merchant pattern covered. */
  AI?: Ai;
  /** Web Push (VAPID): raw P-256 public point and private scalar, base64url. See README. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
};

/** VAPID "sub": how a push service reaches whoever sends (Apple requires https: or mailto:). */
const appUrl = "https://financeiro-pwa.cauevieira-dev07.workers.dev";
type Context = { waitUntil(promise: Promise<unknown>): void };
/** `server`: the server's Pluggy application, when PLUGGY_CLIENT_ID and _SECRET are set. */
type Services = { env: Env; db: SupabaseClient; server: Pluggy | null };

/** Workers AI pass over the user's uncategorised expenses; never fails the caller. */
const autoCategorize = ({ env, db }: Services, userId: string) =>
  env.AI
    ? categorizePending(db, env.AI, userId).catch((error) => {
      console.error("ai categorize", userId, error);
      return 0;
    })
    : Promise.resolve(0);

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

async function signedInUser({ db }: Pick<Services, "db">, request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Entre na sua conta para continuar.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sessão expirada. Entre novamente.");
  return data.user.id;
}

type CredentialsRow = { user_id: string; client_id: string; client_secret: string; webhook_id: string | null };
type OwnApp = { clientId: string; webhookId: string | null; pluggy: Pluggy };

const credentialsKey = (env: Env) => {
  const key = env.PLUGGY_CREDENTIALS_KEY;
  if (!validKey(key)) throw new HttpError(503, "Aplicação própria da Pluggy ainda não configurada no servidor.");
  return key;
};

async function ownAppFrom(env: Env, row: CredentialsRow): Promise<OwnApp> {
  const secret = await openSecret(row.client_secret, credentialsKey(env), row.user_id);
  return { clientId: row.client_id, webhookId: row.webhook_id, pluggy: pluggyClient(row.client_id, secret) };
}

/** The user's own Pluggy application (Perfil → Open Finance), or null when they have none. */
async function ownApp({ env, db }: Services, userId: string) {
  const { data, error } = await db.from("pluggy_credentials")
    .select("user_id, client_id, client_secret, webhook_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? ownAppFrom(env, data as CredentialsRow) : null;
}

function serverApp({ server }: Services) {
  if (!server) throw new HttpError(409, "Cadastre a sua aplicação da Pluggy nesta tela para conectar bancos.");
  return server;
}

/** The application a stored connection was made with. */
async function appFor(services: Services, userId: string, own: boolean) {
  if (!own) return serverApp(services);
  const app = await ownApp(services, userId);
  if (!app) throw new HttpError(409, "A aplicação da Pluggy desta conexão foi removida. Cadastre-a de novo.");
  return app.pluggy;
}

/** New connections use the user's own application when there is one, else the server's. */
async function newConnectionApp(services: Services, userId: string) {
  const app = await ownApp(services, userId);
  return app ? { pluggy: app.pluggy, own: true } : { pluggy: serverApp(services), own: false };
}

async function ownedItem({ db }: Services, userId: string, itemId: unknown) {
  if (typeof itemId !== "string" || !itemId) throw new HttpError(400, "Conexão inválida.");
  const { data, error } = await db.from("pluggy_items").select("item_id, own_app").eq("item_id", itemId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Conexão não encontrada.");
  return { itemId, own: Boolean(data.own_app) };
}

const body = async (request: Request) => (await request.json().catch(() => ({}))) as Record<string, unknown>;

async function connectToken(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  const { itemId } = await body(request);
  const pluggy = itemId !== undefined
    ? await appFor(services, userId, (await ownedItem(services, userId, itemId)).own)
    : (await newConnectionApp(services, userId)).pluggy;
  return json({ connectToken: await pluggy.connectToken(userId, itemId as string | undefined) });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stores an item and imports it. Two origins: Pluggy Connect in the app (the item carries this
 * user's clientUserId) or a connection made in the Pluggy Dashboard, as Meu Pluggy requires
 * (no clientUserId; the id is pasted in the app). The item is looked up in the user's own
 * Pluggy application when they registered one, else in the server's; Pluggy only returns items
 * of that application, and an item already linked to another user is refused below.
 */
async function registerItem(services: Services, request: Request, context: Context) {
  const userId = await signedInUser(services, request);
  const { itemId } = await body(request);
  if (typeof itemId !== "string" || !uuid.test(itemId.trim())) throw new HttpError(400, "ID de conexão inválido.");
  const id = itemId.trim();
  const { data: existing, error } = await services.db.from("pluggy_items").select("user_id, own_app").eq("item_id", id).maybeSingle();
  if (error) throw error;
  if (existing && existing.user_id !== userId) throw new HttpError(403, "Esta conexão não pertence à sua conta.");
  const { pluggy, own } = existing
    ? { pluggy: await appFor(services, userId, Boolean(existing.own_app)), own: Boolean(existing.own_app) }
    : await newConnectionApp(services, userId);
  const item = await pluggy.item(id).catch((failure) => {
    if (failure instanceof PluggyError && (failure.status === 404 || failure.status === 400)) {
      throw new HttpError(404, "Conexão não encontrada na sua aplicação da Pluggy.");
    }
    throw failure;
  });
  if (item.clientUserId && item.clientUserId !== userId) throw new HttpError(403, "Esta conexão não pertence à sua conta.");
  if (!existing) {
    const saved = await services.db.from("pluggy_items").insert({
      user_id: userId, item_id: item.id, connector_name: item.connector.name, status: item.status ?? null, own_app: own,
    });
    if (saved.error) throw saved.error;
  }
  const result = await syncItem(services.db, pluggy, userId, item.id);
  context.waitUntil(autoCategorize(services, userId));
  return json(result);
}

/** GET /api/pluggy/app: whether the user registered their own Pluggy application. */
async function appStatus(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  const { data, error } = await services.db.from("pluggy_credentials")
    .select("client_id, webhook_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return json({
    own: data ? { clientId: data.client_id, webhook: Boolean(data.webhook_id) } : null,
    serverApp: Boolean(services.server),
    available: validKey(services.env.PLUGGY_CREDENTIALS_KEY),
  });
}

async function ownAppConnections({ db }: Services, userId: string) {
  const { count, error } = await db.from("pluggy_items").select("item_id", { count: "exact", head: true })
    .eq("user_id", userId).eq("own_app", true);
  if (error) throw error;
  return count ?? 0;
}

/**
 * PUT /api/pluggy/app: checks the client id and secret with Pluggy, creates this app's webhook
 * there (custom header with a fresh token, stored only as a hash) and saves the sealed secret.
 * Saving again with the same client id rotates the secret and the webhook token.
 */
async function saveApp(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  const key = credentialsKey(services.env);
  const { clientId, clientSecret } = await body(request);
  const id = typeof clientId === "string" ? clientId.trim() : "";
  const secret = typeof clientSecret === "string" ? clientSecret.trim() : "";
  if (!uuid.test(id)) throw new HttpError(400, "O Client ID tem o formato 00000000-0000-0000-0000-000000000000.");
  if (secret.length < 8 || secret.length > 256 || /\s/.test(secret)) throw new HttpError(400, "Client Secret inválido.");
  if (id === services.env.PLUGGY_CLIENT_ID?.trim()) throw new HttpError(400, "Essa já é a aplicação do servidor; não precisa cadastrar.");
  const { data: taken, error } = await services.db.from("pluggy_credentials").select("user_id").eq("client_id", id).neq("user_id", userId).limit(1);
  if (error) throw error;
  if (taken?.length) throw new HttpError(409, "Esta aplicação da Pluggy já está cadastrada em outra conta.");
  const previous = await ownApp(services, userId).catch(() => null);
  if (previous && previous.clientId !== id && (await ownAppConnections(services, userId)) > 0) {
    throw new HttpError(409, "Desconecte os bancos da aplicação atual antes de trocar de aplicação.");
  }

  const pluggy = pluggyClient(id, secret);
  await pluggy.verify().catch((failure) => {
    if (failure instanceof PluggyError) throw new HttpError(400, "A Pluggy não aceitou esse Client ID e Client Secret.");
    throw failure;
  });
  const token = newToken();
  const webhookUrl = `${new URL(request.url).origin}/api/pluggy/webhook`;
  const webhookId = await pluggy.createWebhook(webhookUrl, { "X-Webhook-Token": token }).catch((failure) => {
    console.error("pluggy own webhook", failure);
    return null;
  });
  const saved = await services.db.from("pluggy_credentials").upsert({
    user_id: userId,
    client_id: id,
    client_secret: await sealSecret(secret, key, userId),
    webhook_token_hash: await hashToken(token),
    webhook_id: webhookId,
    updated_at: new Date().toISOString(),
  });
  if (saved.error) throw saved.error;
  // The old webhook now carries a token nobody accepts; remove it when Pluggy lets us.
  if (previous?.webhookId) await previous.pluggy.deleteWebhook(previous.webhookId).catch(() => undefined);
  return json({ own: { clientId: id, webhook: Boolean(webhookId) } });
}

/** DELETE /api/pluggy/app: only once no connection depends on the application. */
async function removeApp(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  if ((await ownAppConnections(services, userId)) > 0) {
    throw new HttpError(409, "Desconecte os bancos desta aplicação antes de removê-la.");
  }
  const app = await ownApp(services, userId).catch(() => null);
  if (app?.webhookId) await app.pluggy.deleteWebhook(app.webhookId).catch(() => undefined);
  const { error } = await services.db.from("pluggy_credentials").delete().eq("user_id", userId);
  if (error) throw error;
  return json({ ok: true });
}

/**
 * "Sincronizar", one connection per request: asks the bank for fresh data (arrives by webhook)
 * and imports what Pluggy has now. The app calls it for each connection in turn, because one
 * invocation on the Workers free plan can't make enough subrequests for several banks (above all
 * on the first, 12-month import).
 */
async function syncOne(services: Services, request: Request, context: Context, itemId: string) {
  const userId = await signedInUser(services, request);
  const pluggy = await appFor(services, userId, (await ownedItem(services, userId, itemId)).own);
  // Meu Pluggy items refuse PATCH (they follow the original connection's daily sync); ignore.
  await pluggy.refreshItem(itemId).catch(() => undefined);
  const result = await syncItem(services.db, pluggy, userId, itemId);
  context.waitUntil(autoCategorize(services, userId));
  return json(result);
}

/** Older app versions: syncs only the connection updated longest ago. */
async function syncStalest(services: Services, request: Request, context: Context) {
  const userId = await signedInUser(services, request);
  const { data, error } = await services.db.from("pluggy_items").select("item_id, own_app").eq("user_id", userId)
    .order("last_synced_at", { ascending: true, nullsFirst: true }).limit(1);
  if (error) throw error;
  const stalest = data?.[0];
  if (!stalest) return json({ inserted: 0 });
  const pluggy = await appFor(services, userId, Boolean(stalest.own_app));
  const result = await syncItem(services.db, pluggy, userId, stalest.item_id as string);
  context.waitUntil(autoCategorize(services, userId));
  return json(result);
}

/** After a CSV/OFX import in the app: classifies what arrived without a category. */
async function categorize(services: Services, request: Request) {
  const userId = await signedInUser(services, request);
  return json({ categorized: await autoCategorize(services, userId) });
}

async function removeItem(services: Services, request: Request, itemId: string) {
  const userId = await signedInUser(services, request);
  const pluggy = await appFor(services, userId, (await ownedItem(services, userId, itemId)).own);
  await pluggy.deleteItem(itemId).catch((error) => {
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
async function updateTransactions(db: SupabaseClient, pluggy: Pluggy, userId: string, event: WebhookEvent) {
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

/**
 * Which application sent a webhook. The server's app proves it with PLUGGY_WEBHOOK_SECRET (HMAC
 * signature or custom header token); a user's own app with the token created in saveApp, looked
 * up by its hash. Null when neither matches.
 */
async function webhookSource({ env, db }: Services, request: Request, raw: string) {
  const header = request.headers.get(tokenHeader);
  const secret = env.PLUGGY_WEBHOOK_SECRET ?? "";
  if (validToken(header, secret) || (await validSignature(request.headers.get("x-pluggy-signature"), raw, secret))) {
    return { own: false as const };
  }
  if (!header || header.trim().length < 32) return null;
  const { data, error } = await db.from("pluggy_credentials")
    .select("user_id, client_id, client_secret, webhook_id").eq("webhook_token_hash", await hashToken(header)).maybeSingle();
  if (error) throw error;
  return data ? { own: true as const, row: data as CredentialsRow } : null;
}

async function webhook(services: Services, request: Request, context: Context) {
  const raw = await request.text();
  const source = await webhookSource(services, request, raw);
  if (!source) return json({ error: "unauthorized" }, 401);
  const event = JSON.parse(raw) as WebhookEvent & { clientId?: string };
  if (source.own && event.clientId && event.clientId !== source.row.client_id) return json({ error: "unauthorized" }, 401);
  if (event.eventId) {
    const seen = await services.db.from("pluggy_events").insert({ event_id: event.eventId });
    if (seen.error?.code === "23505") return json({ ok: true, duplicate: true });
    if (seen.error) throw seen.error;
  }
  if (!event.itemId) return json({ ok: true });
  const { data: owner, error } = await services.db.from("pluggy_items").select("user_id, own_app").eq("item_id", event.itemId).maybeSingle();
  if (error) throw error;
  // An app may only speak for its own connections: the server's for own_app = false, a user's
  // app only for that user's own_app = true.
  const sameApp = owner && (source.own
    ? owner.own_app === true && owner.user_id === source.row.user_id
    : owner.own_app !== true);
  if (!owner || !sameApp) return json({ ok: true, ignored: true });
  const userId = owner.user_id as string;

  // Pluggy expects a 2xx within 10 s: answer now, work after the response.
  context.waitUntil((async () => {
    const pluggy = source.own ? (await ownAppFrom(services.env, source.row)).pluggy : serverApp(services);
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
        await updateTransactions(services.db, pluggy, userId, event);
        break;
      case "item/created":
      case "item/updated":
      case "transactions/created":
        await syncItem(services.db, pluggy, userId, event.itemId!);
        await autoCategorize(services, userId);
        await notifyLargeExpenses(services.env, userId);
        break;
    }
    await services.db.from("pluggy_events").delete().lt("received_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  })().catch((error) => console.error("pluggy webhook", event.event, error)));
  return json({ ok: true });
}

/**
 * Cron backup for the webhook (hourly, see cloudflare.config.ts): imports what Pluggy already has
 * for the connection synced longest ago, so purchases arrive even if a notification is lost. One
 * connection per run keeps it within the free plan's subrequest limit; every connection still
 * comes around every few hours.
 */
async function syncStalestItem(services: Services) {
  const { data, error } = await services.db.from("pluggy_items").select("item_id, user_id, own_app")
    .order("last_synced_at", { ascending: true, nullsFirst: true }).limit(3);
  if (error) throw error;
  // A connection whose app can't be used (credentials removed or unreadable) fails before any
  // Pluggy call; move on to the next one so it doesn't hold up everybody else's backup.
  for (const { item_id, user_id, own_app } of data ?? []) {
    const pluggy = await appFor(services, user_id, Boolean(own_app))
      .catch((failure) => console.error("pluggy scheduled sync app", item_id, failure));
    if (!pluggy) continue;
    await syncItem(services.db, pluggy, user_id, item_id)
      .catch((failure) => console.error("pluggy scheduled sync", item_id, failure));
    break;
  }
  // Also covers CSV/OFX imports and anything a previous pass missed.
  if (services.env.AI) {
    await categorizeEveryone(services.db, services.env.AI).catch((failure) => console.error("ai scheduled categorize", failure));
  }
}

/** Service-role client; `fetcher` lets a caller count its subrequests. */
const database = (env: Env, fetcher?: typeof fetch) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(fetcher && { global: { fetch: fetcher } }),
  });

function servicesFor(env: Env): Services {
  return {
    env,
    db: database(env),
    server: serverConfigured(env) ? pluggyClient(env.PLUGGY_CLIENT_ID!, env.PLUGGY_CLIENT_SECRET!) : null,
  };
}

const vapidKeys = (env: Env): VapidKeys | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: appUrl }
    : null;
const pushConfigured = (env: Env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && vapidKeys(env));

/**
 * Right after a webhook import: tells the user about large purchases at once instead of waiting
 * for the cron. Few subrequests, since the sync already spent most of this invocation's.
 */
async function notifyLargeExpenses(env: Env, userId: string) {
  const keys = vapidKeys(env);
  if (!keys) return;
  const budget = new SubrequestBudget(8);
  await runNotices(database(env, budget.fetch), budget, keys, { userId, kinds: ["large_expense"] })
    .catch((error) => console.error("push after webhook", userId, error));
}

/**
 * Hourly cron. One invocation on the free plan has about 50 subrequests, not enough for a bank
 * sync, the AI pass and the notices together, so they take turns: odd hours (São Paulo) send the
 * notices, even hours sync Pluggy. With no device subscribed the notices cost one query and the
 * sync runs too; without Pluggy configured the notices run every hour.
 */
async function scheduledWork(env: Env, now: Date) {
  const pluggyReady = configured(env);
  const keys = vapidKeys(env);
  const { hour, date } = saoPauloClock(now);
  // Whether this run already spent its subrequests on summaries or notices.
  let busy = false;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && (hour % 2 === 1 || !pluggyReady)) {
    const budget = new SubrequestBudget(45);
    const db = database(env, budget.fetch);
    // Day 1 (with days 2 and 3 to catch up): last month's summary; only missing ones are created.
    if (Number(date.slice(8, 10)) <= 3 && hour >= 9) {
      const created = await generateSummaries(db, env.AI, shiftMonth(date.slice(0, 7), -1))
        .catch((error) => {
          console.error("scheduled summaries", error);
          return [];
        });
      busy ||= created.length > 0;
    }
    if (keys) {
      const result = await runNotices(db, budget, keys, { now })
        .catch((error) => {
          console.error("scheduled push", error);
          return { idle: false };
        });
      busy ||= !result.idle;
      if (hour === 21 && !result.idle) await pruneLog(db, now);
    }
  }
  if (pluggyReady && !busy) await syncStalestItem(servicesFor(env));
}

/**
 * POST /api/summary: last month's summary for the signed-in user, created now when missing (the
 * cron makes it on day 1; this covers the first month and a failed run).
 */
async function summaryNow(env: Env, request: Request) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Resumo ainda não configurado no servidor." }, 503);
  try {
    const db = database(env);
    const userId = await signedInUser({ db }, request);
    const month = shiftMonth(saoPauloClock(new Date()).date.slice(0, 7), -1);
    await generateSummaries(db, env.AI, month, userId);
    const { data, error } = await db.from("monthly_summaries").select("month, numbers, text, dismissed_at")
      .eq("user_id", userId).eq("month", `${month}-01`).maybeSingle();
    if (error) throw error;
    return json({ summary: data ? summaryFrom(data) : null });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("/api/summary", error);
    return json({ error: "Não foi possível gerar o resumo. Tente de novo." }, 502);
  }
}

const pushUnavailable = () => json({ error: "Notificações ainda não configuradas no servidor." }, 503);

/** GET /api/push/key: the VAPID public key the browser subscribes with (not a secret). */
function pushKey(env: Env) {
  const keys = vapidKeys(env);
  return keys ? json({ publicKey: keys.publicKey }) : pushUnavailable();
}

/** POST /api/push/test: sends a sample notification to one of the user's own devices. */
async function pushTest(env: Env, request: Request) {
  const keys = vapidKeys(env);
  if (!keys || !pushConfigured(env)) return pushUnavailable();
  try {
    const db = database(env);
    const userId = await signedInUser({ db }, request);
    const { endpoint } = await body(request);
    if (typeof endpoint !== "string" || !knownPushService(endpoint)) throw new HttpError(400, "Aparelho inválido.");
    const { data, error } = await db.from("push_subscriptions").select("endpoint, p256dh, auth")
      .eq("user_id", userId).eq("endpoint", endpoint).maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Ative as notificações neste aparelho primeiro.");
    const result = await sendPush(data, {
      title: "Notificações ativadas",
      body: "É assim que os avisos do Nítido vão aparecer neste aparelho.",
      url: "/?abrir=profile",
      tag: "teste",
    }, keys, fetch, 600);
    if (result.gone) {
      await db.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
      throw new HttpError(410, "Este aparelho cancelou a inscrição. Ative as notificações de novo.");
    }
    if (!result.ok) throw new HttpError(502, "O serviço de notificações recusou o envio. Tente de novo.");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("/api/push/test", error);
    return json({ error: "Não foi possível enviar o teste. Tente de novo." }, 502);
  }
}

/** Assistant question: checks the session and streams the Workers AI answer as plain text. */
async function chat(env: Env, request: Request) {
  if (request.method !== "POST") return json({ error: "not found" }, 404);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.AI) {
    return json({ error: "Assistente ainda não configurado no servidor." }, 503);
  }
  try {
    await signedInUser(servicesFor(env), request);
    return await answer(env.AI, await body(request));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof ChatInputError) return json({ error: error.message }, 400);
    if (quotaExceeded(error)) return json({ error: "O Nix já respondeu o máximo de hoje. Volta amanhã; a simulação continua funcionando." }, 429);
    console.error("/api/chat", error);
    return json({ error: "O Nix não respondeu. Tente de novo." }, 502);
  }
}

const serverConfigured = (env: Env) => Boolean(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET);
/** Open Finance works with the server's Pluggy app, with users' own apps, or both. */
const configured = (env: Env) =>
  Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && (serverConfigured(env) || validKey(env.PLUGGY_CREDENTIALS_KEY)));

export default {
  async scheduled(controller: { scheduledTime: number }, env: Env, context: Context) {
    context.waitUntil(scheduledWork(env, new Date(controller.scheduledTime))
      .catch((error) => console.error("scheduled", error)));
  },

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
    // The assistant needs only Supabase (to check the session) and Workers AI, not Pluggy.
    if (pathname === "/api/chat") return await chat(env, request);
    // Push needs Supabase and the VAPID keys, not Pluggy.
    if (pathname === "/api/push/key" && request.method === "GET") return pushKey(env);
    if (pathname === "/api/push/test" && request.method === "POST") return await pushTest(env, request);
    if (pathname === "/api/summary" && request.method === "POST") return await summaryNow(env, request);
    if (!configured(env)) {
      return json({ error: "Open Finance ainda não configurado no servidor." }, 503);
    }
    try {
      const services = servicesFor(env);
      const itemRoute = pathname.match(/^\/api\/pluggy\/items\/([^/]+)$/);
      const itemSyncRoute = pathname.match(/^\/api\/pluggy\/items\/([^/]+)\/sync$/);
      if (request.method === "POST" && pathname === "/api/pluggy/webhook") return await webhook(services, request, context);
      if (pathname === "/api/pluggy/app") {
        if (request.method === "GET") return await appStatus(services, request);
        if (request.method === "PUT") return await saveApp(services, request);
        if (request.method === "DELETE") return await removeApp(services, request);
      }
      if (request.method === "POST" && pathname === "/api/pluggy/connect-token") return await connectToken(services, request);
      if (request.method === "POST" && pathname === "/api/pluggy/items") return await registerItem(services, request, context);
      if (request.method === "POST" && itemSyncRoute) return await syncOne(services, request, context, decodeURIComponent(itemSyncRoute[1]));
      if (request.method === "POST" && pathname === "/api/pluggy/sync") return await syncStalest(services, request, context);
      if (request.method === "POST" && pathname === "/api/categorize") return await categorize(services, request);
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
