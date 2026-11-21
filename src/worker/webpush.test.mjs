import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptPayload, fromBase64Url, maxPayload, sendPush, toBase64Url, vapidAuthorization } from "./webpush.ts";

const curve = { name: "ECDH", namedCurve: "P-256" };
const encoder = new TextEncoder();

/** Imports a P-256 key pair from the raw public point and private scalar (base64url). */
async function keyPair(publicKey, privateKey, algorithm = curve, usages = ["deriveBits"]) {
  const point = fromBase64Url(publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33)), ext: true };
  return {
    publicKey: await crypto.subtle.importKey("jwk", jwk, algorithm, true, algorithm.name === "ECDH" ? [] : ["verify"]),
    privateKey: await crypto.subtle.importKey("jwk", { ...jwk, d: privateKey }, algorithm, true, usages),
  };
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** What the browser does (RFC 8291, section 3): returns the plaintext. */
async function decrypt(message, browserKeys, auth) {
  const salt = message.slice(0, 16);
  const idLength = message[20];
  const serverPublic = message.slice(21, 21 + idLength);
  const browserPublic = new Uint8Array(await crypto.subtle.exportKey("raw", browserKeys.publicKey));
  const serverKey = await crypto.subtle.importKey("raw", serverPublic, curve, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, browserKeys.privateKey, 256));
  const info = new Uint8Array([...encoder.encode("WebPush: info\0"), ...browserPublic, ...serverPublic]);
  const ikm = await hkdf(fromBase64Url(auth), shared, info, 32);
  const key = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, message.slice(21 + idLength)));
  assert.equal(record.at(-1), 2, "last record delimiter");
  return new TextDecoder().decode(record.slice(0, -1));
}

test("base64url round trip without padding", () => {
  const bytes = Uint8Array.from({ length: 70 }, (_, i) => (i * 37) % 256);
  const text = toBase64Url(bytes);
  assert.doesNotMatch(text, /[+/=]/);
  assert.deepEqual(fromBase64Url(text), bytes);
  assert.deepEqual(fromBase64Url(text + "=="), bytes);
});

test("matches the RFC 8291 example (appendix A)", async () => {
  const serverKeys = await keyPair(
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  );
  const message = await encryptPayload(
    encoder.encode("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    { salt: fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys },
  );
  assert.equal(
    toBase64Url(message),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("a browser key pair decrypts what was encrypted for it", async () => {
  const browserKeys = await crypto.subtle.generateKey(curve, true, ["deriveBits"]);
  const p256dh = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", browserKeys.publicKey)));
  const auth = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = JSON.stringify({ title: "Conta vence amanhã", body: "Internet: R$ 119,90.", url: "/?abrir=commitments" });
  const message = await encryptPayload(encoder.encode(payload), p256dh, auth);
  assert.equal(new DataView(message.buffer).getUint32(16), 4096);
  assert.equal(await decrypt(message, browserKeys, auth), payload);
  await assert.rejects(() => encryptPayload(new Uint8Array(maxPayload + 1), p256dh, auth), /too large/);
  await assert.rejects(() => encryptPayload(encoder.encode("x"), p256dh.slice(0, 20), auth), /Invalid subscription keys/);
});

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { pair, keys: { publicKey, privateKey: d, subject: "https://app.example" } };
}

test("VAPID header carries a valid ES256 token for the push service origin", async () => {
  const { pair, keys } = await vapidKeys();
  const now = Date.UTC(2026, 10, 21, 12);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc?x=1", keys, now);
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, keys.publicKey);
  const [head, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64Url(head))), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64Url(claims))), {
    aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "https://app.example",
  });
  assert.equal(fromBase64Url(signature).length, 64);
  assert.ok(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, pair.publicKey, fromBase64Url(signature), encoder.encode(`${head}.${claims}`),
  ));
});

test("sendPush posts the encrypted body and reports gone subscriptions", async () => {
  const { keys } = await vapidKeys();
  const browserKeys = await crypto.subtle.generateKey(curve, true, ["deriveBits"]);
  const target = {
    endpoint: "https://web.push.apple.com/QGuQyavXutnMH",
    p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", browserKeys.publicKey))),
    auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: calls.length === 1 ? 201 : 410 });
  };
  assert.deepEqual(await sendPush(target, { title: "Oi" }, keys, fetcher), { ok: true, gone: false, status: 201 });
  assert.deepEqual(await sendPush(target, { title: "Oi" }, keys, fetcher, 60), { ok: false, gone: true, status: 410 });
  const [{ url, init }] = calls;
  assert.equal(url, target.endpoint);
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.equal(init.headers.ttl, "86400");
  assert.equal(calls[1].init.headers.ttl, "60");
  assert.match(init.headers.authorization, /^vapid t=.+, k=/);
  assert.equal(await decrypt(init.body, browserKeys, target.auth), JSON.stringify({ title: "Oi" }));
});
