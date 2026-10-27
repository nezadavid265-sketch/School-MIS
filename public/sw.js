// Service worker: installable app + offline shell. Static files cache-first, GET API network-first with cached fallback.
const VERSION = 'smis-v1';
const SHELL = ['/', '/index.html', '/app.css', '/js/main.js', '/js/core.js', '/js/views.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Never cache sign-in state, backups or exports
  if (/^\/api\/(me|login|logout|backup)/.test(url.pathname)) return;
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || new Response(JSON.stringify({ error: 'Offline and no saved copy of this page yet' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  e.respondWith(caches.match(e.request).then((cached) => {
    const net = fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; }).catch(() => cached || caches.match('/index.html'));
    return cached || net;
  }));
});
