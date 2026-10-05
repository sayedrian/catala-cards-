// Offline support. Online: always fetch the current files (so an update never mixes old and new
// files); the cache is the fallback when offline. Keep CACHE in step with VERSION in js/app.js.
const CACHE = 'catala-cards-v4';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'data/cards.json', 'data/context.json',
  'js/app.js', 'js/fsrs.js', 'js/store.js', 'js/deck.js', 'js/audio.js', 'js/translate.js',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so the new version is cached complete and fresh
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 'no-cache' = check with the server (cheap 304 if unchanged)
      const r = await fetch(e.request, { cache: 'no-cache' });
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
