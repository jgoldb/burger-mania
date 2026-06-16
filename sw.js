/* Burger Mania service worker — offline app shell + PWA installability.
 *
 * The deploy workflow stamps BUILD with the commit SHA (tools/stamp-version.js),
 * so every deploy ships a byte-different SW: the browser sees the change and
 * installs the new worker. It then *waits* — we don't skipWaiting on install —
 * so the running page keeps serving a consistent old build until index.html
 * decides it's safe to swap (postMessage SKIP_WAITING at a non-disruptive
 * moment), at which point activate purges the previous cache and claims the
 * page, and index.html reloads once into the fresh build.
 * Opened from file:// during local dev the SW never registers (service workers
 * need http/https), so playing off disk is completely unaffected.
 */
'use strict';

const BUILD = 'dev';                       // stamped to the commit SHA on deploy
const CACHE = `burger-mania-${BUILD}`;

// Stable-URL shell bits, precached so a cold offline launch works. The js/*.js
// URLs carry a ?v= token only on the deployed build (so this SW can't know them
// at install time) — they're cached at runtime on first load instead.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/biker.webp',
  './assets/biker-back.png',
  './assets/astro.webp',
  './assets/brad.png',
];

self.addEventListener('install', (e) => {
  // Note: no skipWaiting() here — a freshly installed worker stays in "waiting"
  // until the page asks for the swap (see the message handler), so we never cut
  // a build out from under an in-progress ride.
  // Cache shell items one by one so a single missing asset can't fail the lot.
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
});

// index.html sends this once it's safe to upgrade (on a menu/victory screen or
// while backgrounded). skipWaiting() promotes this worker out of "waiting" →
// activate fires (purging the old cache) → clients.claim() → the page sees a
// controllerchange and reloads itself into the new build.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;  // leave cross-origin alone

  // Navigations (the HTML): network-first, so an online visitor always gets the
  // latest index.html — and thus the freshly ?v=-stamped JS URLs — falling back
  // to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      })
      .catch(() => caches.match('./index.html').then((m) => m || caches.match('./'))));
    return;
  }

  // Level maps (levels/*.bmm): network-first, so an edited or newly added map
  // shows up on the next reload (in dev and after a deploy), falling back to the
  // cached copy when offline.
  if (new URL(req.url).pathname.includes('/levels/')) {
    e.respondWith(caches.open(CACHE).then((c) =>
      fetch(req)
        .then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; })
        .catch(() => c.match(req))));
    return;
  }

  // Everything else same-origin (js/*.js?v=…, icons, sprites): stale-while-
  // revalidate — serve the cached copy instantly, refresh it in the background.
  // The ?v= token makes each deploy's JS a fresh URL, so a cached entry is never
  // stale for long and old ones are evicted by the activate-time cache purge.
  e.respondWith(caches.open(CACHE).then((c) =>
    c.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })));
});
