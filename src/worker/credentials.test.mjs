import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashToken, newToken, open, seal, validKey } from './credentials.ts';

const key = 'a1'.repeat(32);

test('a sealed secret opens only with the same key and owner', async () => {
  const sealed = await seal('segredo-da-pluggy', key, 'user-1');
  assert.match(sealed, /^v1\./);
  assert.notEqual(await seal('segredo-da-pluggy', key, 'user-1'), sealed);
  assert.equal(await open(sealed, key, 'user-1'), 'segredo-da-pluggy');
  await assert.rejects(() => open(sealed, key, 'user-2'));
  await assert.rejects(() => open(sealed, 'b2'.repeat(32), 'user-1'));
});

test('only a 32-byte hex key is accepted', () => {
  assert.equal(validKey(key), true);
  assert.equal(validKey('a1'.repeat(16)), false);
  assert.equal(validKey(undefined), false);
  assert.equal(validKey('z'.repeat(64)), false);
});

test('webhook tokens are long and hashed the same way every time', async () => {
  const token = newToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(await hashToken(token), await hashToken(` ${token} `));
  assert.notEqual(await hashToken(token), await hashToken(newToken()));
});
