let deferredInstallPrompt = null;
let swRegistration = null;
const installBtn = document.getElementById('installAppBtn');

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js?v=1.6.0', { updateViaCache: 'none' });
    swRegistration = registration;
    await registration.update();
    return registration;
  } catch (err) {
    console.warn('Service Worker:', err);
    return null;
  }
}

window.requestBackgroundSync = async () => {
  const registration = swRegistration || await navigator.serviceWorker?.ready;
  if (!registration) return;
  try {
    if ('sync' in registration) await registration.sync.register('giatoc-sync');
    else registration.active?.postMessage({ type: 'SYNC_NOW' });
  } catch {
    registration.active?.postMessage({ type: 'SYNC_NOW' });
  }
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    await registerSW();
    window.updateConnectivity?.();
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('sw-reloaded-v1.6.0')) return;
    sessionStorage.setItem('sw-reloaded-v1.6.0', '1');
    location.reload();
  });

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'OFFLINE_QUEUE_CHANGED') {
      window.updateConnectivity?.();
      if (navigator.onLine) window.refreshAfterBackgroundSync?.();
    }
  });
}

window.addEventListener('online', () => {
  window.updateConnectivity?.();
  window.requestBackgroundSync?.();
});
window.addEventListener('offline', () => window.updateConnectivity?.());

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installBtn) installBtn.hidden = false;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if (installBtn) installBtn.hidden = true;
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}


function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64); const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
window.getPushStatus = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { supported: false, subscribed: false, permission: 'unsupported' };
  const registration = swRegistration || await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { supported: true, subscribed: !!subscription, permission: Notification.permission };
};
window.enablePushNotifications = async () => {
  if (!navigator.onLine) throw new Error('Cần mạng để bật Push Notification.');
  if (!('PushManager' in window) || !('Notification' in window)) throw new Error('Trình duyệt này không hỗ trợ Push Notification.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bạn chưa cho phép thông báo trên thiết bị này.');
  const registration = swRegistration || await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const r = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.publicKey) throw new Error(j.error || 'Không lấy được VAPID public key.');
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(j.publicKey) });
  }
  const r = await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Không thể lưu Push Subscription.');
  window.refreshPushStatus?.(); return true;
};
window.disablePushNotifications = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = swRegistration || await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    if (navigator.onLine) await fetch('/api/push/unsubscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(()=>{});
    await subscription.unsubscribe();
  }
  window.refreshPushStatus?.();
};
window.addEventListener('load', () => setTimeout(() => window.refreshPushStatus?.(), 500));
