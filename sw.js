// CrewBoard service worker — caches the app shell so it opens and fully works with no
// network connection, once it's been loaded online at least once.
//
// Bump CACHE_NAME any time the app's cached files change meaningfully, so returning users
// get the fresh version instead of being stuck on a stale cached copy.
const CACHE_NAME = 'crewboard-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails entirely if even one request fails — cache what we can individually
      // instead, so a single blocked/slow CDN request doesn't prevent the rest (and the app
      // itself) from being cached.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('CrewBoard SW: could not cache', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests — POST/PUT etc. (none in this app, but just in case) pass through.
  if(event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Cache-first: instant offline load. Update the cache in the background from the
      // network when possible, so the next load picks up any change without needing a
      // full re-install.
      const networkFetch = fetch(event.request).then((response) => {
        if(response && response.status === 200){
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached); // offline and not cached: nothing we can do for this request

      return cached || networkFetch;
    })
  );
});
