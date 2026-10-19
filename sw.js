/* CBC Audio Cues v0.6: offline app shell only. Imported music is private
   on-device data in IndexedDB, never placed in the service worker cache. */
const CACHE_NAME = 'cbc-audio-cues-shell-v6';
const SHELL = ['./', './index.html', './style.css', './app.js',
  './manifest.webmanifest', './icons/icon-180.png',
  './icons/icon-192.png', './icons/icon-512.png'];
const APP_SCOPE_PATH = new URL(self.registration.scope).pathname;
const SHELL_PATHS = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(SHELL))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key =>
      key.startsWith('cbc-audio-cues-shell-') && key !== CACHE_NAME
    ).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_SCOPE_PATH)) return;
  const navigation = request.mode === 'navigate';
  if (!navigation && !SHELL_PATHS.has(url.pathname)) return;

  // Fetch updates when online; if connectivity is lost, fall back to a complete
  // app-shell copy. No playlist data or audio is uploaded to any server.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (!fresh.ok) throw new Error('App shell file was not available');
      const cache = await caches.open(CACHE_NAME);
      const cacheKey = navigation ? new URL('./index.html', self.registration.scope) : request;
      event.waitUntil(cache.put(cacheKey, fresh.clone()));
      return fresh;
    } catch (_) {
      const cache = await caches.open(CACHE_NAME);
      const cacheKey = navigation ? new URL('./index.html', self.registration.scope) : request;
      const fallback = await cache.match(cacheKey);
      if (fallback) return fallback;
      return Response.error();
    }
  })());
});
