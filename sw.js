// Service worker: online carica sempre la versione più recente, offline usa la copia salvata.
// Aggiorna VERSION quando cambi i file.
const VERSION = 'v5';
const SHELL = `shell-${VERSION}`;
const FONTS = 'fonts';
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
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  // cache: 'reload' evita di salvare copie vecchie dalla cache HTTP del browser
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // font: prima la cache, cambiano di rado
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') (await caches.open(FONTS)).put(request, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== location.origin) return;

  // file dell'app: prima la rete (senza cache HTTP), poi la copia salvata se offline
  e.respondWith((async () => {
    try {
      const res = await withTimeout(fetch(request, { cache: 'no-cache' }), NETWORK_TIMEOUT);
      if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
      return res;
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    }
  })());
});
