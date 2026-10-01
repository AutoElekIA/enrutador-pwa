// sw.js — modo debug: sin caché, sin interceptar fetch
const VERSION = 'enrutador-debug';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ⚠️ Sin fetch handler: el navegador maneja TODO directamente
console.log('SW debug activo — caché deshabilitado');