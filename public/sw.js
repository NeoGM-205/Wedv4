const CACHE_NAME = 'giatoc-name-hub-v1.2.1';
const STATIC_ASSETS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/avatar-boss.svg',
  '/assets/avatar-elder.svg',
  '/assets/avatar-member.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // HTML/JS/CSS luôn ưu tiên bản mới từ mạng để tránh giao diện mới chạy JS cũ.
  if (req.mode === 'navigate' || ['script', 'style'].includes(req.destination)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return cached || caches.match('/offline.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok && ['image', 'font'].includes(req.destination)) {
        caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
      }
      return res;
    }))
  );
});
