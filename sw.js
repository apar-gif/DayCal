// DayCal service worker — lets the app load with no connection.
//
// ⚠️ BUMP CACHE_VERSION ON EVERY DEPLOY, or devices keep running the old code.
const CACHE_VERSION = 'daycal-v8';

// Files from this site to cache up front.
const APP_SHELL = [
  './',
  './index.html',
  './privacy.html',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

// Third-party files the app needs to render (fonts, icon font, supabase-js).
// Cached as they're used, so the first visit must be online.
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// NEVER cached: Supabase (your live data) and Google auth/calendar APIs.
// Anything not listed above simply passes through to the network.

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Add individually — one missing file shouldn't fail the whole install
    await Promise.all(APP_SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(e => console.warn('[sw] skipped', url, e))
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Fresh if possible, cached if not — so an online load always gets new code.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const hit = await cache.match(request) || (fallbackUrl && await cache.match(fallbackUrl));
    if (hit) return hit;
    throw e;
  }
}

// Instant from cache, refreshed in the background for next time.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request);
  const update = fetch(request).then(res => {
    // opaque (no-cors) responses are fine to store for fonts/scripts
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || update.then(r => r || Promise.reject(new Error('offline and not cached')));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                  // writes always go to the network

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {                     // the page itself
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }
  if (sameOrigin) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // Everything else (Supabase, Google APIs) — untouched.
});
