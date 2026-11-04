// ============================================================================
// sw.js — Network-First Service Worker (v3)
// Always fetches fresh code when online; falls back to cache only when offline.
// ============================================================================

const CACHE_NAME = 'kisan-unnati-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/custom.css',
  './data/i18n_dict.json',
  './data/agri_knowledge_base.json',
  './data/mandi_latest.json',
  './js/app.js',
  './js/i18n_voice.js',
  './js/geolocation_map.js',
  './js/api_telemetry.js',
  './js/decision_engine.js',
  './js/ai_krishi_mitra.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((networkRes) => {
        if (event.request.url.startsWith(self.location.origin)) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkRes;
      })
      .catch(() => caches.match(event.request))
  );
});