/**
 * Per-user Pluggy credentials at rest: the client secret is sealed with AES-GCM under
 * PLUGGY_CREDENTIALS_KEY (32 random bytes, hex), and the webhook token is kept only as a hash.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const toHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Whether the key is 64 hex characters (32 bytes); anything else is refused. */
export const validKey = (hex: string | undefined): hex is string => Boolean(hex && /^[0-9a-f]{64}$/i.test(hex.trim()));

async function aesKey(hex: string) {
  if (!validKey(hex)) throw new Error("PLUGGY_CREDENTIALS_KEY inválida");
  const raw = Uint8Array.from(hex.trim().match(/../g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `v1.<iv>.<ciphertext>` in base64; a fresh 12-byte IV each time. `context` binds it to its owner. */
export async function seal(plain: string, keyHex: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await aesKey(keyHex),
    encoder.encode(plain),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function open(sealed: string, keyHex: string, context: string) {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Credencial cifrada em formato desconhecido");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(context) },
    await aesKey(keyHex),
    fromBase64(data),
  );
  return decoder.decode(plain);
}

/** A random 64-character token for the webhook header. */
export const newToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

export async function hashToken(token: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token.trim()))));
}
