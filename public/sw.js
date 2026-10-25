const CACHE = "payit-shell-v5";
const SHELL = ["/fonts/sora-latin-variable.woff2", "/offline.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("payit-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Never cache HTML; fall back to the offline page when offline.
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html"))); return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
