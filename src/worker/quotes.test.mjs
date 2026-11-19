import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brapiSource, firstOf, normalizeTicker, refreshQuotes, valueCents, yahooSource } from './quotes.ts';

test('tickers are normalized and validated', () => {
  assert.equal(normalizeTicker(' petr4 '), 'PETR4');
  assert.equal(normalizeTicker('BOVA11.SA'), 'BOVA11');
  assert.equal(normalizeTicker('aapl34'), 'AAPL34');
  assert.equal(normalizeTicker('PETR'), null);
  assert.equal(normalizeTicker('PETR4; drop'), null);
  assert.equal(normalizeTicker(42), null);
});

test('the value is quantity times price, rounded to cents', () => {
  assert.equal(valueCents(100, 3820), 382000);
  assert.equal(valueCents(10.5, 3821), 40121);
  assert.equal(valueCents(0.333, 1000), 333);
});

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('brapi and Yahoo answers become cents', async () => {
  const brapi = brapiSource('t', reply(200, { results: [{ regularMarketPrice: 38.2, regularMarketTime: '2026-11-18T20:07:00.000Z' }] }));
  assert.deepEqual(await brapi('PETR4'), { priceCents: 3820, at: '2026-11-18T20:07:00.000Z' });
  const yahoo = yahooSource(reply(200, { chart: { result: [{ meta: { regularMarketPrice: 120.555, regularMarketTime: 1795464000 } }] } }));
  assert.equal((await yahoo('BOVA11')).priceCents, 12056);
  await assert.rejects(() => brapiSource('t', reply(429, { message: 'limite' }))('PETR4'), /429/);
  await assert.rejects(() => brapiSource('t', reply(200, { results: [{}] }))('PETR4'), /inválida/);
});

test('the backup source answers when the first one fails', async () => {
  const failing = async () => { throw new Error('fora do ar'); };
  const backup = async () => ({ priceCents: 100, at: '2026-11-18T20:00:00.000Z' });
  assert.equal((await firstOf(failing, backup)('PETR4')).priceCents, 100);
  await assert.rejects(() => firstOf(failing)('PETR4'), /fora do ar/);
});

/** Minimal stand-in for the Supabase query builder used by refreshQuotes. */
function fakeDb(rows) {
  const updates = [];
  const filters = [];
  const select = {
    not: () => select,
    eq: (column, value) => { filters.push([column, value]); return select; },
    then: (resolve) => resolve({ data: rows.filter((row) => filters.every(([c, v]) => row[c] === v)), error: null }),
  };
  return {
    updates,
    from: () => ({
      select: () => select,
      update: (values) => ({ eq: async (_column, id) => { updates.push({ id, ...values }); return { error: null }; } }),
    }),
  };
}

test('each ticker is quoted once and recent quotes are skipped', async () => {
  const now = Date.parse('2026-11-18T20:10:00.000Z');
  const db = fakeDb([
    { id: 'a', user_id: 'u1', ticker: 'PETR4', quantity: '100', quoted_at: null },
    { id: 'b', user_id: 'u2', ticker: 'PETR4', quantity: '10.5', quoted_at: '2026-11-18T18:00:00.000Z' },
    { id: 'c', user_id: 'u1', ticker: 'VALE3', quantity: '1', quoted_at: '2026-11-18T20:08:00.000Z' },
    { id: 'd', user_id: 'u1', ticker: 'XXXX3', quantity: '1', quoted_at: null },
  ]);
  const asked = [];
  const quote = async (ticker) => {
    asked.push(ticker);
    if (ticker === 'XXXX3') throw new Error('não existe');
    return { priceCents: 3820, at: '2026-11-18T20:07:00.000Z' };
  };
  const result = await refreshQuotes(db, quote, { minAgeMs: 5 * 60_000, now });
  assert.deepEqual(asked, ['PETR4', 'XXXX3']);
  assert.deepEqual(result, { updated: 2, failed: ['XXXX3'] });
  assert.deepEqual(db.updates.map(({ id, value_cents, as_of }) => [id, value_cents, as_of]), [
    ['a', 382000, '2026-11-18'],
    ['b', 40110, '2026-11-18'],
  ]);
});

test('a user refresh only touches that user\'s holdings', async () => {
  const db = fakeDb([
    { id: 'a', user_id: 'u1', ticker: 'PETR4', quantity: '1', quoted_at: null },
    { id: 'b', user_id: 'u2', ticker: 'VALE3', quantity: '1', quoted_at: null },
  ]);
  const result = await refreshQuotes(db, async () => ({ priceCents: 500, at: '2026-11-18T20:07:00.000Z' }), { userId: 'u2' });
  assert.deepEqual(result, { updated: 1, failed: [] });
  assert.equal(db.updates[0].id, 'b');
});
