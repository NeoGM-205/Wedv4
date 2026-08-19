(() => {
  const DB_NAME = 'giatoc-name-hub-offline';
  const DB_VERSION = 2;
  let dbPromise;

  function openDB() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB không được hỗ trợ'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không thể mở dữ liệu offline'));
    });
    return dbPromise;
  }

  async function transact(storeName, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = fn(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Lỗi IndexedDB'));
      tx.onabort = () => reject(tx.error || new Error('Giao dịch IndexedDB bị hủy'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Lỗi IndexedDB'));
    });
  }

  async function putSnapshot(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({ key, value, savedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getSnapshot(key) {
    const db = await openDB();
    const tx = db.transaction('snapshots', 'readonly');
    const row = await requestResult(tx.objectStore('snapshots').get(key));
    return row || null;
  }

  async function deleteSnapshot(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function enqueue(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      const req = tx.objectStore('queue').add({ status: 'pending', retries: 0, lastError: '', ...item, createdAt: item.createdAt || Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function listQueue() {
    const db = await openDB();
    const tx = db.transaction('queue', 'readonly');
    const items = await requestResult(tx.objectStore('queue').getAll());
    return (items || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function deleteQueue(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateQueue(id, patch) {
    const db = await openDB();
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const row = await requestResult(store.get(id));
    if (!row) return false;
    store.put({ ...row, ...patch, id });
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); });
  }

  async function countQueue() {
    const db = await openDB();
    return requestResult(db.transaction('queue', 'readonly').objectStore('queue').count());
  }

  async function clearAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['snapshots', 'queue'], 'readwrite');
      tx.objectStore('snapshots').clear();
      tx.objectStore('queue').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  window.OfflineDB = { putSnapshot, getSnapshot, deleteSnapshot, enqueue, listQueue, deleteQueue, updateQueue, countQueue, clearAll };
})();
