// sw.js - Service Worker para Reunión+
// Estrategia: cache-first para el app shell; network-first con fallback para Tailwind CDN y fuentes.

const CACHE_VERSION = 'rp-v215';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
  './db.js',
  './logic.js',
  './epub.js',
  './xlsx.js',
  './firebase-config.js',
  './supabase-config.js',
  './firestore.js',
  './auth.js',
  './migracion.js',
  './sync.js',
  './styles.css',
  './fonts/material-symbols.woff2',
  './fonts/inter-latin.woff2',
  './fonts/playfair-latin.woff2',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/jszip/jszip.min.js',
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

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Recursos externos (CDN Tailwind y fuentes Inter/Playfair):
  // NO los interceptamos. El navegador los gestiona normalmente (online).
  // Cuando offline, fallan sin error y caen al fallback del sistema.
  // La fuente de íconos Material Symbols es local (precacheada) → siempre disponible.
  if (url.origin !== self.location.origin) return;

  // Navegaciones: devolver index.html cacheado si offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Recursos del propio origen: cache-first
  e.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});