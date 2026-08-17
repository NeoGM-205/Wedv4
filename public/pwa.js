let deferredInstallPrompt = null;
const installBtn = document.getElementById('installAppBtn');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js?v=1.2.1', { updateViaCache: 'none' });
      await registration.update();
    } catch (err) {
      console.warn('Service Worker:', err);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('sw-reloaded-v1.2.1')) return;
    sessionStorage.setItem('sw-reloaded-v1.2.1', '1');
    location.reload();
  });
}

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
