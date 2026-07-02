/* ============================================================
   sw.js — Service Worker
   Sistem Tempahan Bilik Media — lapisan PWA sahaja.
   TIDAK menyentuh logik tempahan/admin — hanya cache aset statik
   supaya app boleh dibuka pantas & ada fallback offline ringkas.
   ============================================================ */

// Naikkan versi ini setiap kali aset statik (html/css/js/ikon) dikemaskini
// supaya pengguna sedia ada dapat cache baharu (lihat juga toast "Versi baharu").
const SW_VERSION   = 'v1';
const STATIC_CACHE = `tbm-static-${SW_VERSION}`;
const RUNTIME_CACHE = `tbm-runtime-${SW_VERSION}`;
const OFFLINE_URL   = '/offline.html';

// Aset teras — dipratahang (precache) semasa install supaya app boleh
// dibuka walaupun rangkaian perlahan/terputus sejurus selepas install.
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/offline.html',
  '/manifest.json',
  '/css/app.css',
  '/css/admin.css',
  '/css/pwa.css',
  '/js/app.js',
  '/js/admin.js',
  '/js/pwa.js',
  '/assets/logo-tempahan-bilik-media.jpg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.ico'
];

// ── INSTALL: precache app shell ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => console.warn('[SW] Precache gagal (sebahagian):', err))
  );
  self.skipWaiting(); // waiting dikawal manual via mesej SKIP_WAITING (lihat pwa.js)
});

// ── ACTIVATE: buang cache lama (elak duplicate/stale cache) ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ── MESEJ daripada halaman (untuk "Muat Semula" bila versi baharu) ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // jangan sentuh POST/PUT/DELETE (tempahan, login, dll.)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // jangan cache pihak ketiga

  // PENTING: jangan sekali-kali cache respons API tempahan/admin —
  // sentiasa terus ke rangkaian supaya data (jadual, status bilik, rekod) segar.
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          JSON.stringify({ ok: false, error: 'Tiada sambungan internet.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Navigasi HTML (buka /, /index.html, /admin.html terus di address bar) —
  // Network-First supaya kandungan sentiasa terkini bila online,
  // fallback ke cache, dan fallback akhir ke offline.html bila tiada langsung.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Aset statik (css/js/ikon/logo/font) — Cache-First + kemaskini latar
  // belakang (stale-while-revalidate) supaya pantas tetapi tidak "terkunci"
  // pada versi lama selama-lamanya.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Selain itu (default) — cuba rangkaian dahulu, fallback cache jika ada.
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
