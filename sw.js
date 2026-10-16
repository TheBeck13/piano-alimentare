// Service worker: l'app funziona anche offline. Aggiorna VERSION quando cambi i file.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'js/app.js',
  'js/parser.js',
  'js/storage.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// stale-while-revalidate: risponde subito dalla cache e intanto aggiorna in background
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return;

  e.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: sameOrigin });
    const network = fetch(request).then(async (res) => {
      if (res.ok || res.type === 'opaque') {
        const cache = await caches.open(sameOrigin && FILES.some((f) => url.pathname.endsWith(f.replace('./', '/'))) ? SHELL : RUNTIME);
        cache.put(request, res.clone());
      }
      return res;
    }).catch(() => null);
    if (cached) {
      e.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    if (request.mode === 'navigate') return caches.match('index.html');
    return Response.error();
  })());
});
