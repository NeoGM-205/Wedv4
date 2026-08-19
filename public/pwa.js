let deferredInstallPrompt = null;
let swRegistration = null;
const installBtn = document.getElementById('installAppBtn');

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js?v=1.4.0', { updateViaCache: 'none' });
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
    if (sessionStorage.getItem('sw-reloaded-v1.4.0')) return;
    sessionStorage.setItem('sw-reloaded-v1.4.0', '1');
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
