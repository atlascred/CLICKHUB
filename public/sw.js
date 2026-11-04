/* Only public installation assets are cached. CRM records and documents stay online. */
const CACHE_PREFIX = 'clickhub-pwa-static-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const OFFLINE_PAGE = '/offline.html';
const ASSETS = [OFFLINE_PAGE, '/pwa/apple-touch-icon.png', '/pwa/icon-192.png', '/pwa/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.headers.has('RSC') || url.searchParams.has('_rsc')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_PAGE)) || Response.error();
    }));
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (await cache.match(url.pathname)) || fetch(request)));
  }
});
