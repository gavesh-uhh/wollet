const CACHE = "payit-shell-v11";
let developmentMode = false;
const SHELL = ["/", "/fonts/sora-latin-variable.woff2", "/offline.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/logos/seylan.png", "/logos/boc.svg", "/logos/chase.svg", "/logos/registry/index.json"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const html = await (await cache.match("/")).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => new URL(match[1], self.location.origin))
      .filter(url => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/") && !url.search)
      .map(url => url.href);
    await cache.addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("payit-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
const isAsset = url => url.origin === self.location.origin &&
  (SHELL.includes(url.pathname) || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/ocr/") || url.pathname.startsWith("/logos/registry/"));

// Include resources loaded before the worker took control on the first visit.
self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_WALLET_ASSETS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(
    event.data.urls.filter(value => {
      try {
        const url = new URL(value);
        return isAsset(url) && !url.search && url.pathname !== "/";
      } catch { return false; }
    }).map(value => cache.add(value))
  )));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (developmentMode) return;
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // A worker left by a production preview must not serve old development
        // bundles. Let Next's live development server own these requests.
        if (response.headers.get("cache-control")?.includes("no-cache") &&
            (await response.clone().text()).includes("next-devtools")) {
          developmentMode = true;
          await self.registration.unregister();
          await caches.delete(CACHE);
          return response;
        }
        // Cache only the bare shell: share URLs contain personal details.
        if (response.ok && !url.search) {
          const cache = await caches.open(CACHE);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        return (await caches.match("/")) || (await caches.match("/offline.html"));
      }
    })());
    return;
  }
  if (!isAsset(url) || url.pathname === "/" || url.search) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
