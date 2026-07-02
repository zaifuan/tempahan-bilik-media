/* ============================================================
   pwa.js — Lapisan PWA (daftar service worker, install prompt,
   pengesanan versi baharu, indikator offline).

   Fail ini BERDIRI SENDIRI — tidak memanggil / mengubah mana-mana
   fungsi dalam app.js atau admin.js (enjin tempahan / admin tidak
   disentuh). Selamat dimasukkan di index.html & admin.html.
   ============================================================ */
(function () {
  'use strict';

  // ── 0. Sokongan asas sahaja — gagal senyap jika tidak disokong ──
  var isSecure = (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  var supportsSW = ('serviceWorker' in navigator);

  var installBtn  = document.getElementById('pwaInstallBtn');
  var updateBar   = document.getElementById('pwaUpdateBar');
  var updateBtn   = document.getElementById('pwaUpdateBtn');
  var offlineBadge = document.getElementById('pwaOfflineBadge');

  var deferredInstallPrompt = null;
  var waitingWorker = null;

  // ── 1. Daftar Service Worker ─────────────────────────────────
  function registerServiceWorker() {
    if (!supportsSW || !isSecure) {
      // Fallback senyap — browser lama / http biasa (contoh: dev localhost tanpa https)
      // Sistem tetap berfungsi seperti biasa tanpa ciri PWA.
      return;
    }

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        // Semak kemaskini serta-merta bila tab dibuka semula
        reg.update().catch(function () {});

        // Jika sudah ada worker menunggu (contoh: tab lama masih terbuka semasa deploy)
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting;
          showUpdateBar();
        }

        reg.addEventListener('updatefound', function () {
          var newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Versi baharu siap dipasang & sedia menunggu — bukan pemasangan pertama.
              waitingWorker = newWorker;
              showUpdateBar();
            }
          });
        });

        // Semak kemaskini secara berkala (setiap 60 minit) selagi tab dibuka
        setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
      }).catch(function (err) {
        console.warn('[PWA] Pendaftaran Service Worker gagal:', err);
      });

      // Reload sekali sahaja bila worker baharu ambil alih kawalan
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  function showUpdateBar() {
    if (!updateBar) return; // halaman ini tiada markup bar (selamat diabaikan)
    updateBar.classList.add('show');
  }
  function hideUpdateBar() {
    if (!updateBar) return;
    updateBar.classList.remove('show');
  }

  if (updateBtn) {
    updateBtn.addEventListener('click', function () {
      if (waitingWorker) {
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
      hideUpdateBar();
    });
  }

  // ── 2. Install Prompt (Android/Windows Chrome & Edge) ────────
  // TIDAK popup automatik — hanya simpan event & papar butang kecil.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) installBtn.classList.add('show');
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredInstallPrompt) return;
      installBtn.classList.remove('show');
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function () {
        deferredInstallPrompt = null;
      });
    });
  }

  window.addEventListener('appinstalled', function () {
    if (installBtn) installBtn.classList.remove('show');
    deferredInstallPrompt = null;
  });

  // Jika sudah dibuka dalam mod "standalone" (sudah dipasang), jangan tunjuk butang.
  function isRunningStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true; // iOS Safari
  }
  if (isRunningStandalone() && installBtn) {
    installBtn.classList.remove('show');
  }

  // ── 3. Indikator Offline/Online ──────────────────────────────
  function positionOfflineBadge() {
    if (!offlineBadge) return;
    var header = document.querySelector('.header, .admin-header');
    var top = header ? Math.round(header.getBoundingClientRect().bottom + 10) : 14;
    offlineBadge.style.top = top + 'px';
  }
  function updateOnlineStatus() {
    if (!offlineBadge) return;
    if (navigator.onLine) {
      offlineBadge.classList.remove('show');
    } else {
      positionOfflineBadge();
      offlineBadge.classList.add('show');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  window.addEventListener('resize', function () {
    if (offlineBadge && offlineBadge.classList.contains('show')) positionOfflineBadge();
  });

  // ── Mula ───────────────────────────────────────────────────
  registerServiceWorker();
  updateOnlineStatus();
})();
