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

async function worker({ windows = [] } = {}) {
  const script = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const origin = 'https://financeiro.example';
  const handlers = new Map();
  const shown = [];
  const opened = [];
  vm.runInNewContext(script, {
    self: {
      location: { origin },
      addEventListener: (event, handler) => handlers.set(event, handler),
      registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
      clients: {
        matchAll: async () => windows,
        openWindow: async (url) => { opened.push(url); },
        claim: async () => {},
      },
    },
    URL, Headers, Response,
  });
  const dispatch = async (name, event) => {
    let pending;
    handlers.get(name)({ ...event, waitUntil: (promise) => { pending = promise; } });
    await pending;
  };
  return { origin, dispatch, shown, opened };
}

test('shows a push message and keeps its screen, ignoring other origins', async () => {
  const sw = await worker();
  const message = { title: 'Conta vence amanhã', body: 'Internet: R$ 119,90.', url: '/?abrir=commitments', tag: 'contas-amanha' };
  await sw.dispatch('push', { data: { json: () => message } });
  await sw.dispatch('push', { data: { json: () => ({ body: 'x', url: 'https://evil.example/' }) } });
  await sw.dispatch('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'texto puro' } });
  assert.equal(sw.shown[0].title, 'Conta vence amanhã');
  assert.equal(sw.shown[0].options.body, 'Internet: R$ 119,90.');
  assert.equal(sw.shown[0].options.tag, 'contas-amanha');
  assert.equal(sw.shown[0].options.data.url, '/?abrir=commitments');
  assert.equal(sw.shown[1].title, 'Nítido');
  assert.equal(sw.shown[1].options.data.url, '/');
  assert.equal(sw.shown[2].options.body, 'texto puro');
});

test('a tapped notification switches the open app or opens it on that screen', async () => {
  const messages = [];
  let focused = false;
  const open = { url: 'https://financeiro.example/', postMessage: (data) => messages.push(data), focus: async () => { focused = true; } };
  const notification = (url) => ({ notification: { data: { url }, close() {} } });

  const running = await worker({ windows: [open] });
  await running.dispatch('notificationclick', notification('/?abrir=activity'));
  // The message object comes from the worker's realm: compare its content.
  assert.equal(JSON.stringify(messages), JSON.stringify([{ type: 'open', url: '/?abrir=activity' }]));
  assert.ok(focused);
  assert.equal(running.opened.length, 0);

  const closed = await worker();
  await closed.dispatch('notificationclick', notification('/?abrir=analytics'));
  assert.deepEqual(closed.opened, ['/?abrir=analytics']);
});
