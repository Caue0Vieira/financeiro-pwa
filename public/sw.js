const CACHE_NAME = 'financeiro-static-v2';
const OFFLINE_PATH = '/offline.html';
const STATIC_PATHS = new Set([
  OFFLINE_PATH,
  '/offline.css',
  '/manifest.webmanifest',
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

  if (!STATIC_PATHS.has(url.pathname) && !url.pathname.startsWith('/assets/')) return;
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
