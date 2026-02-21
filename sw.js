// TheFairMap Service Worker v2.9 - minimal, only caches app shell
const CACHE_NAME = 'fairmap-v2.9';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/map.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Delete ALL old caches including ones that may have cached tile data
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER cache or intercept map tile requests — always go to network
  const tileHosts = ['openfreemap.org', 'maptiler.com', 'maplibre', 'openstreetmap', 'tile'];
  if (tileHosts.some(h => url.hostname.includes(h))) return;

  // NEVER cache API calls
  if (url.pathname.startsWith('/api/')) return;

  // For everything else: serve from cache, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
