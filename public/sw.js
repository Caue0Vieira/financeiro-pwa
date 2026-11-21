const CACHE_NAME = 'financeiro-static-v11';
const OFFLINE_PATH = '/offline.html';
const STATIC_PATHS = new Set([
  OFFLINE_PATH,
  '/offline.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',
  '/icons/apple-touch-icon.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_PATH, '/offline.css'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith('financeiro-static-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)))),
  ]));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const offline = await caches.match(OFFLINE_PATH);
      if (!offline) return Response.error();
      // Hosts can redirect .html to a clean URL. Use a fresh response when
      // serving the cached page to a navigation with a manual redirect mode.
      const headers = new Headers(offline.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(offline.body, { status: offline.status, headers });
    }));
    return;
  }

  // The manifest is never cached: the Worker answers it with the icon chosen in the app.
  const isStatic = STATIC_PATHS.has(url.pathname)
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/');
  if (!isStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

// Push notifications (sent by the Worker, see src/worker/notifications.ts). The payload is
// { title, body, url, tag }; `url` is a screen of the app such as "/?abrir=commitments".
const appUrl = (value) => {
  try {
    const url = new URL(value || '/', self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
};

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(message.title || 'Nítido', {
    body: message.body || '',
    tag: message.tag || undefined,
    icon: '/icons/icon-192.png',
    lang: 'pt-BR',
    data: { url: appUrl(message.url) },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    // An open app switches screens itself (FinanceApp listens); otherwise open it on that screen.
    if (open) {
      open.postMessage({ type: 'open', url });
      return open.focus();
    }
    return self.clients.openWindow(url);
  })());
});
