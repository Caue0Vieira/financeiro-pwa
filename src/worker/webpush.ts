/**
 * Web Push without a Node library: VAPID (RFC 8292) signs a JWT with ES256 and the payload is
 * encrypted with aes128gcm (RFC 8291), all with Web Crypto, which Workers and Node both have.
 */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Record size written in the header; the whole message fits in one record. */
const recordSize = 4096;
/** Largest payload one record carries (record minus the 16-byte tag and the delimiter). */
export const maxPayload = recordSize - 17;

/**
 * Encrypts `payload` for the browser keys of a subscription (p256dh and auth, base64url).
 * `salt` and `serverKeys` are only passed by tests; each message normally gets fresh ones.
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  options: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
) {
  if (payload.length > maxPayload) throw new Error("Push payload too large");
  const browserPublic = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  if (browserPublic.length !== 65 || authSecret.length !== 16) throw new Error("Invalid subscription keys");
  const serverKeys = options.serverKeys
    ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey) as ArrayBuffer);
  const browserKey = await crypto.subtle.importKey("raw", browserPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: browserKey }, serverKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), browserPublic, serverPublic), 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", contentKey as BufferSource, "AES-GCM", false, ["encrypt"]);
  // A single (last) record: the payload followed by the 0x02 delimiter, no padding.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    concat(payload, new Uint8Array([2])) as BufferSource,
  ));
  const header = new Uint8Array(21 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  return concat(header, ciphertext);
}

/** VAPID keys as stored in the Worker secrets: raw public point and private scalar, base64url. */
export interface VapidKeys { publicKey: string; privateKey: string; subject: string }

const signingKeys = new Map<string, Promise<CryptoKey>>();
function signingKey({ publicKey, privateKey }: VapidKeys) {
  let key = signingKeys.get(publicKey);
  if (!key) {
    const point = fromBase64Url(publicKey);
    if (point.length !== 65 || point[0] !== 4) throw new Error("Invalid VAPID public key");
    key = crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33)), d: privateKey, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    signingKeys.set(publicKey, key);
  }
  return key;
}

/** `Authorization` header for a push service: a JWT for its origin, valid for 12 hours. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const json = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: keys.subject,
  })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(keys), encoder.encode(unsigned));
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushResult {
  ok: boolean;
  /** The browser unsubscribed (404/410): the subscription should be deleted. */
  gone: boolean;
  status: number;
}

/** Encrypts and posts one message. `fetcher` lets the caller count subrequests. */
export async function sendPush(
  target: PushTarget,
  message: unknown,
  keys: VapidKeys,
  fetcher: typeof fetch = fetch,
  ttl = 24 * 3600,
): Promise<PushResult> {
  const body = await encryptPayload(encoder.encode(JSON.stringify(message)), target.p256dh, target.auth);
  const response = await fetcher(target.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(target.endpoint, keys),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttl),
      urgency: "normal",
    },
    body: body as BodyInit,
  });
  // The body is not needed; release it.
  await response.body?.cancel().catch(() => undefined);
  return { ok: response.ok, gone: response.status === 404 || response.status === 410, status: response.status };
}
