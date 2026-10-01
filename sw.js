const CACHE = 'enrutador-v16';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ⚠️ CLAVE: no interceptar peticiones a otros dominios (Nominatim, OCR.space, etc.)
  if (url.origin !== self.location.origin) {
    return; // Dejar que el navegador las maneje normalmente
  }

  // Para nuestro propio sitio: cache-first
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});