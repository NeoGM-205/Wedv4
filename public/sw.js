const VERSION = '1.9.0';
const APP_CACHE = `giatoc-app-${VERSION}`;
const RUNTIME_CACHE = `giatoc-runtime-${VERSION}`;
const DB_NAME = 'giatoc-name-hub-offline';
const DB_VERSION = 2;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/style.css?v=1.9.0',
  '/offline-db.js?v=1.9.0',
  '/app.js?v=1.9.0',
  '/pwa.js?v=1.9.0',
  '/assets/avatar-boss.svg',
  '/assets/avatar-elder.svg',
  '/assets/avatar-member.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png'
];
const OPTIONAL_ASSETS = ['/vendor/qrcode.bundle.js?v=1.9.0', '/vendor/pdf-lib.min.js?v=1.9.0'];

async function cacheAppShell() {
  const cache = await caches.open(APP_CACHE);
  await cache.addAll(CORE_ASSETS);
  await Promise.allSettled(OPTIONAL_ASSETS.map(url => cache.add(url)));
}

self.addEventListener('install', event => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== APP_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put('/index.html', response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await caches.match('/index.html')) || (await caches.match('/')) || (await caches.match('/offline.html'));
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => null);
  return cached || (await network) || caches.match('/offline.html');
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dữ liệu tài khoản/API không được cache trong Cache Storage. Ứng dụng tự lưu snapshot cần thiết bằng IndexedDB.
  if (url.pathname.startsWith('/api/')) return;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/uploads/') || request.destination === 'image' || request.destination === 'font') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (['script', 'style', 'manifest'].includes(request.destination) || url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueItems() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0)));
    req.onerror = () => reject(req.error);
  });
}

async function deleteQueueItem(id) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateQueueItem(id, patch) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite'); const store=tx.objectStore('queue'); const req=store.get(id);
    req.onsuccess=()=>{ if(req.result) store.put({ ...req.result, ...patch, id }); };
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}

async function notifyClients(type, payload = {}) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach(client => client.postMessage({ type, ...payload }));
}

async function syncQueue() {
  const items = await queueItems();
  let done = 0;
  for (const item of items) {
    if (item.status === 'conflict') continue;
    let response;
    try {
      if (item.type === 'avatar' && item.fileBlob) {
        const fd = new FormData();
        fd.append('avatar', item.fileBlob, item.fileName || 'avatar.jpg');
        response = await fetch('/api/avatar', { method: 'POST', body: fd, credentials: 'include' });
      } else {
        response = await fetch(item.url, {
          method: item.method || 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: item.body == null ? undefined : JSON.stringify(item.body)
        });
      }
      if (response.status === 401 || response.status === 403) break;
      if (!response.ok) {
        if (response.status === 409 && item.type === 'profile') {
          const conflictData = await response.json().catch(() => ({}));
          await updateQueueItem(item.id, { status: 'conflict', conflictData, lastError: conflictData.error || 'Xung đột hồ sơ', lastTriedAt: Date.now() });
          continue;
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const detail = await response.json().catch(() => ({}));
          await updateQueueItem(item.id, { status: 'error', retries: (item.retries || 0) + 1, lastError: detail.error || `HTTP ${response.status}`, lastTriedAt: Date.now() });
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      await deleteQueueItem(item.id);
      done++;
    } catch (error) {
      await updateQueueItem(item.id, { status: 'error', retries: (item.retries || 0) + 1, lastError: String(error?.message || error), lastTriedAt: Date.now() }).catch(()=>{});
      break;
    }
  }
  await notifyClients('OFFLINE_QUEUE_CHANGED', { done });
}

self.addEventListener('sync', event => {
  if (event.tag === 'giatoc-sync') event.waitUntil(syncQueue());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json?.() || {}; } catch { data = { body: event.data?.text?.() || 'Bạn có thông báo mới.' }; }
  const route = data.route || 'notifications';
  const url = data.dmUserId ? `/#friends` : data.room ? `/#chat` : `/#${route}`;
  event.waitUntil(self.registration.showNotification(data.title || 'GiaTộc ┊Name Hub', {
    body: data.body || 'Bạn có thông báo mới.',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: data.dmUserId ? `dm-${data.dmUserId}` : undefined,
    data: { url, route, room: data.room || '', dmUserId: data.dmUserId || '' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/#notifications';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) { await client.navigate(target).catch(()=>{}); return client.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'SYNC_NOW') event.waitUntil(syncQueue());
  if (event.data?.type === 'CLEAR_RUNTIME_CACHE') event.waitUntil(caches.delete(RUNTIME_CACHE));
  if (event.data?.type === 'CLEAR_ALL_CACHES') event.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await cacheAppShell();})());
});
