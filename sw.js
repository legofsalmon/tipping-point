/*
 * Service worker: makes the calculator work with no connection once it has
 * been loaded once.
 *
 * Bump CACHE when any of the shell files change, or browsers will keep
 * serving the old copy.
 */
const CACHE = 'tipping-point-v1';

// Relative to the worker's own URL, so this works just as well when the app
// is served from a subdirectory (GitHub Pages project sites, say).
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/physics.js',
  'src/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // one bad URL shouldn't fail the whole install, so add them singly
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        // refresh in the background so the next visit is up to date
        fetchAndStore(request).catch(() => {});
        return hit;
      }
      return fetchAndStore(request).catch(() => {
        // an offline navigation still gets the app shell
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});

function fetchAndStore(request) {
  return fetch(request).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
