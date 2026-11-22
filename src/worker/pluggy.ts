import type { PluggyAccount, PluggyTransaction } from "./mapping";

const api = "https://api.pluggy.ai";

export type PluggyItem = {
  id: string;
  clientUserId?: string | null;
  status?: string;
  executionStatus?: string;
  connector: { id: number; name: string };
};

export class PluggyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * API keys last 2 hours and POST /auth is rate limited, so each application's key is shared per
 * isolate (one entry per client id: the server's app and each user's own app).
 */
const cachedKeys = new Map<string, { key: string; secret: string; expires: number }>();

export function pluggyClient(clientId: string, clientSecret: string) {
  async function apiKey() {
    const cached = cachedKeys.get(clientId);
    if (cached && cached.secret === clientSecret && cached.expires > Date.now()) return cached.key;
    const response = await fetch(`${api}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!response.ok) throw new PluggyError(response.status, "Falha ao autenticar na Pluggy.");
    const { apiKey: key } = (await response.json()) as { apiKey: string };
    cachedKeys.set(clientId, { key, secret: clientSecret, expires: Date.now() + 110 * 60_000 });
    return key;
  }

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const send = async () =>
      fetch(`${api}${path}`, {
        ...init,
        headers: { "content-type": "application/json", "x-api-key": await apiKey(), ...init.headers },
      });
    let response = await send();
    if (response.status === 401) {
      cachedKeys.delete(clientId); // revoked or expired early
      response = await send();
    }
    if (!response.ok) throw new PluggyError(response.status, `Pluggy respondeu ${response.status} em ${path.split("?")[0]}.`);
    return (await response.json()) as T;
  }

  return {
    /** Fails with a PluggyError when the client id and secret don't authenticate. */
    verify: () => apiKey().then(() => undefined),
    /** Webhook of this application for every event, sending `headers` with each delivery. */
    createWebhook: (url: string, headers: Record<string, string>) =>
      call<{ id: string }>("/webhooks", { method: "POST", body: JSON.stringify({ url, event: "all", headers }) })
        .then(({ id }) => id),
    deleteWebhook: (webhookId: string) => call<unknown>(`/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" }),
    connectToken: (clientUserId: string, itemId?: string) =>
      call<{ accessToken: string }>("/connect_token", {
        method: "POST",
        body: JSON.stringify({ ...(itemId && { itemId }), options: { clientUserId, avoidDuplicates: true } }),
      }).then(({ accessToken }) => accessToken),
    item: (itemId: string) => call<PluggyItem>(`/items/${encodeURIComponent(itemId)}`),
    /** Asks Pluggy to fetch fresh data from the bank; new transactions arrive by webhook. */
    refreshItem: (itemId: string) => call<PluggyItem>(`/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: "{}" }),
    deleteItem: (itemId: string) => call<unknown>(`/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
    accounts: (itemId: string) =>
      call<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`).then(({ results }) => results),
    async transactions(accountId: string, query: { dateFrom?: string; ids?: string[] }) {
      const params = new URLSearchParams({ accountId });
      if (query.dateFrom) params.set("dateFrom", query.dateFrom);
      if (query.ids) params.set("ids", query.ids.join(","));
      const results: PluggyTransaction[] = [];
      let next: string | null = `?${params}`;
      for (let page = 0; next && page < 40; page++) {
        const data: { results: PluggyTransaction[]; next: string | null } = await call(`/v2/transactions${next}`);
        results.push(...data.results);
        next = data.next;
      }
      return results;
    },
  };
}

export type Pluggy = ReturnType<typeof pluggyClient>;

/** Header the Pluggy dashboard sends as a custom header with the shared token. */
export const tokenHeader = "x-webhook-token";

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * Constant-time check of the custom header token configured in the Pluggy dashboard (used when
 * the account has no signing secret). Short secrets are refused so a weak value can't be used.
 */
export function validToken(header: string | null, secret: string) {
  return secret.length >= 32 && header !== null && sameText(header.trim(), secret);
}

/** Constant-time check of `X-Pluggy-Signature: t=<unix>,v1=<hex>` (HMAC-SHA256 of `<t>.<raw body>`). */
export async function validSignature(header: string | null, body: string, secret: string, now = Date.now()) {
  if (!secret) return false; // not configured: accept nothing
  const parts = Object.fromEntries((header ?? "").split(",").map((part) => part.trim().split("=", 2)));
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${body}`)));
  const expected = [...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return sameText(String(parts.v1).toLowerCase(), expected);
}
