// sw.js - Service Worker para Reunión+
// Estrategia: cache-first para el app shell; network-first con fallback para Tailwind CDN y fuentes.

const CACHE_VERSION = 'rp-v9';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
  './db.js',
  './styles.css',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './discursos.json',
  './participantes.json',
  './grupos.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // Sólo pre-cacheamos el app shell (recursos del propio origen).
      // Los recursos externos (Tailwind CDN y fuentes) los cachea el navegador
      // a través de las etiquetas <script>/<link> y el SW los gestiona en runtime.
      await Promise.allSettled(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navegaciones: devolver index.html cacheado si offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Recursos del propio origen: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Recursos externos (CDN Tailwind y fuentes): stale-while-revalidate
  // Usamos mode: 'no-cors' para evitar bloqueos CORS (respuestas opacas cacheables).
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req, { mode: 'no-cors' }).then((res) => {
        if (res && (res.type === 'opaque' || res.ok)) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});