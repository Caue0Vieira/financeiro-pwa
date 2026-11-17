import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

test('serves redirected offline HTML as a new response for navigation', async () => {
  const script = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const origin = 'https://financeiro.example';
  const handlers = new Map();
  const cached = new Response('<h1>Sem conexão</h1>', {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': '16',
    },
  });
  Object.defineProperty(cached, 'redirected', { value: true });

  vm.runInNewContext(script, {
    self: {
      location: { origin },
      addEventListener: (event, handler) => handlers.set(event, handler),
    },
    URL, Headers, Response,
    caches: { match: async () => cached },
    fetch: async () => { throw new Error('Offline'); },
  });

  let response;
  handlers.get('fetch')({
    request: { url: origin + '/', method: 'GET', mode: 'navigate', redirect: 'manual' },
    respondWith: (pending) => { response = pending; },
  });

  const offline = await response;
  assert.equal(offline.redirected, false);
  assert.equal(offline.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(offline.headers.get('content-encoding'), null);
  assert.equal(await offline.text(), '<h1>Sem conexão</h1>');
});
