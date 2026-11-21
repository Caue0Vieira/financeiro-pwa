import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runNotices, saoPauloClock, SubrequestBudget } from "./notifications.ts";
import { toBase64Url } from "./webpush.ts";

/** Minimal stand-in for the Supabase client: records each query and answers from `tables`. */
function fakeDb(tables, rpcs = {}) {
  const calls = [];
  const run = (op) => {
    calls.push(op);
    const handler = tables[op.table];
    return { data: typeof handler === "function" ? handler(op) : handler ?? [], error: null };
  };
  const from = (table) => {
    const op = { table, action: "select", filters: [] };
    const chain = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") return (resolve, reject) => Promise.resolve().then(() => run(op)).then(resolve, reject);
        return (...args) => {
          if (["upsert", "delete", "update", "insert"].includes(prop)) {
            op.action = prop;
            op.payload = args[0];
          } else if (prop !== "select") op.filters.push([prop, ...args]);
          return chain;
        };
      },
    });
    return chain;
  };
  return {
    calls,
    from,
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      return { data: rpcs[name]?.(args) ?? [], error: null };
    },
  };
}
const has = (op, ...filter) => op.filters.some((item) => JSON.stringify(item) === JSON.stringify(filter));

const vapid = await (async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), privateKey: d, subject: "https://app.example" };
})();
async function browserKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))), auth: toBase64Url(new Uint8Array(16).fill(7)) };
}

const ana = "00000000-0000-0000-0000-00000000000a";
const bia = "00000000-0000-0000-0000-00000000000b";
const subscriptions = [
  { id: "ana-phone", user_id: ana, endpoint: "https://fcm.googleapis.com/fcm/send/ana-phone", ...(await browserKeys()), preferences: {} },
  { id: "ana-laptop", user_id: ana, endpoint: "https://updates.push.services.mozilla.com/wpush/v2/ana", ...(await browserKeys()), preferences: { budget: false } },
  { id: "bia-phone", user_id: bia, endpoint: "https://web.push.apple.com/bia", ...(await browserKeys()), preferences: { largeExpenseMin: 100000 } },
  { id: "evil", user_id: bia, endpoint: "https://evil.example/hook", ...(await browserKeys()), preferences: {} },
];
// Saturday 2026-11-21, 12h in São Paulo.
const noon = new Date("2026-11-21T15:00:00Z");

function data() {
  return fakeDb({
    push_subscriptions: (op) => (op.action === "select" ? subscriptions.filter((row) => !has(op, "eq", "user_id", ana) || row.user_id === ana) : []),
    notification_log: (op) => (op.action === "select" ? [{ user_id: ana, kind: "bill_due", ref: "luz" }] : []),
    transactions: (op) => {
      if (has(op, "eq", "status", "planned")) return [{ id: "luz", user_id: ana, description: "Energia", amount_cents: -16340, occurred_on: "2026-11-22" }];
      if (has(op, "eq", "source", "pluggy")) return [{ id: "tv", user_id: bia, description: "TV", amount_cents: -250000, occurred_on: "2026-11-21" }];
      return [];
    },
    recurring_rules: [],
    cards: [{ id: "nu", user_id: ana, name: "Nubank", closing_day: 23, due_day: 30, bill_balance_cents: 50000 }],
    card_invoice_dates: [],
    category_budgets: [{ user_id: ana, category: "Alimentação", amount_cents: 60000 }],
    monthly_budgets: [],
  }, { notification_spending: () => [{ user_id: ana, category: "Alimentação", spent: 70000 }] });
}

const realFetch = globalThis.fetch;
let pushes = [];
function pushService(status = () => 201) {
  pushes = [];
  globalThis.fetch = async (url, init) => {
    pushes.push({ url, init });
    return new Response(null, { status: status(url) });
  };
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("São Paulo clock", () => {
  assert.deepEqual(saoPauloClock(noon), { date: "2026-11-21", hour: 12 });
  assert.deepEqual(saoPauloClock(new Date("2026-11-22T02:30:00Z")), { date: "2026-11-21", hour: 23 });
});

test("sends each device what it wants, skips what was sent, logs what was delivered", async () => {
  pushService((url) => (url.includes("apple") ? 410 : 201));
  const db = data();
  const budget = new SubrequestBudget(45);
  const result = await runNotices(db, budget, vapid, { now: noon });
  // Ana's phone: invoice + budget (the bill was already sent); laptop: invoice only (budget off).
  // Bia's phone: the TV (above her R$ 1.000 minimum), but Apple says it's gone. "evil" is never called.
  assert.deepEqual(pushes.map(({ url }) => url).sort(), [
    "https://fcm.googleapis.com/fcm/send/ana-phone",
    "https://fcm.googleapis.com/fcm/send/ana-phone",
    "https://updates.push.services.mozilla.com/wpush/v2/ana",
    "https://web.push.apple.com/bia",
  ]);
  assert.deepEqual(result, { idle: false, sent: 3, gone: 1, pending: 0 });
  const log = db.calls.find((op) => op.table === "notification_log" && op.action === "upsert");
  assert.deepEqual(log.payload.map(({ user_id, kind, ref }) => [user_id, kind, ref]).sort(), [
    [ana, "budget", "alimentacao:2026-11:100"],
    [ana, "budget", "alimentacao:2026-11:80"],
    [ana, "invoice_closing", "nu:2026-11-23"],
  ]);
  const cleanup = db.calls.find((op) => op.table === "push_subscriptions" && op.action === "delete");
  assert.ok(has(cleanup, "in", "id", ["bia-phone"]));
  const lastSent = db.calls.find((op) => op.table === "push_subscriptions" && op.action === "update");
  assert.ok(has(lastSent, "in", "id", ["ana-phone", "ana-laptop"]));
  assert.ok(budget.used <= 45);
});

test("stops before the subrequest limit and leaves the rest for the next run", async () => {
  pushService();
  const db = data();
  const budget = new SubrequestBudget(5);
  const result = await runNotices(db, budget, vapid, { now: noon });
  assert.equal(pushes.length, 2);
  assert.equal(result.sent, 2);
  assert.equal(result.pending, 2);
});

test("at night nothing is loaded; with no devices the run is idle", async () => {
  pushService();
  const night = data();
  assert.deepEqual(await runNotices(night, new SubrequestBudget(45), vapid, { now: new Date("2026-11-21T06:00:00Z") }),
    { idle: false, sent: 0, gone: 0, pending: 0 });
  assert.equal(night.calls.length, 1);
  const empty = fakeDb({ push_subscriptions: [] });
  assert.equal((await runNotices(empty, new SubrequestBudget(45), vapid, { now: noon })).idle, true);
  assert.equal(empty.calls.length, 1);
  assert.equal(pushes.length, 0);
});

test("the webhook asks only for one user's large expenses", async () => {
  pushService();
  const db = data();
  await runNotices(db, new SubrequestBudget(8), vapid, { now: noon, userId: ana, kinds: ["large_expense"] });
  const tables = db.calls.map((op) => op.table ?? op.rpc);
  assert.ok(!tables.includes("cards") && !tables.includes("category_budgets"));
  assert.ok(has(db.calls[0], "eq", "user_id", ana));
  assert.equal(pushes.length, 0);
});
