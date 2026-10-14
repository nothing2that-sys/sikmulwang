const CACHE = "sikmulwang-shell-__VERSION__";
const FILES = __FILES__;
const ASSETS = new Set(FILES);
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match("/"))
        .then((shell) => shell || fetch(request)),
    );
  } else if (!url.search && ASSETS.has(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(request, { ignoreVary: true }))
        .then((asset) => asset || fetch(request)),
    );
  }
});
