// Gera o par de chaves VAPID das notificações push (P-256), no formato que o Worker usa:
// VAPID_PUBLIC_KEY é o ponto público bruto e VAPID_PRIVATE_KEY o escalar privado, ambos base64url.
// Uso: node scripts/vapid-keys.mjs   (veja README → "Notificações push")
const base64url = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
