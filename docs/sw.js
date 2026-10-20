// Offline support: serve from cache first, refresh the cache in the background.
// Bump CACHE when deploying so old files are dropped.
const CACHE = 'corpus-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'data/words.json', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache, so a new version never caches stale files
  const fresh = SHELL.map((url) => new Request(url, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const network = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || network),
  );
  e.waitUntil(network.then(() => {}, () => {}));
});
