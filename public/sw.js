const CACHE = 'dh-lib-v1';
const ASSETS = ['/', '/css/style.css', '/js/app.js', '/js/views.js', '/js/ai.js', '/js/charts.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) return;     // 接口始终走网络
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match('/')))
  );
});
