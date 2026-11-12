const CACHE_NAME = 'quickwashhub-shell-v15';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=12',
  '/app.js?v=10',
  '/admin-zones.js?v=2',
  '/policies.html',
  '/policies.css?v=1',
  '/policies.js?v=1',
  '/manifest.webmanifest?v=4',
  '/icons/icon-192.png?v=4',
  '/icons/icon-512.png?v=4',
  '/icons/icon-512.svg?v=4'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('quickwashhub-shell-') && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const update = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      });
      if (cached) { event.waitUntil(update.catch(() => {})); return cached; }
      const shellPage = url.pathname === '/' || url.pathname === '/index.html';
      return update.catch(async () => shellPage ? (await caches.match('/')) || Response.error() : Response.error());
    })());
    return;
  }

  if (request.destination === 'style' || request.destination === 'script' || url.pathname.endsWith('.webmanifest')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    })());
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
