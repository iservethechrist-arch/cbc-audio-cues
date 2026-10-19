/* Offline app-shell caching for HTTPS-hosted installations. Audio is NOT cached here;
   imported audio is stored separately in IndexedDB on the device. */
const CACHE_NAME = 'cbc-audio-cues-shell-v5';
const APP_SHELL = ['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
