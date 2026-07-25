/* eHive Circle — PWA service worker.
   App-shell + static assets are cached for offline load; the API is never
   cached (always fresh). Bump CACHE to invalidate on a breaking change. */
const CACHE = "ehive-v2";
const SHELL = "/portal.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache the API — always go to the network so data is never stale.
  if (url.pathname.startsWith("/api/")) return;

  // SPA navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(SHELL).then((r) => r || caches.match(req))),
    );
    return;
  }

  // Same-origin static assets (hashed bundle, icons, css/js): cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
      ),
    );
    return;
  }

  // Cross-origin (fonts): cache-first, network fallback.
  event.respondWith(caches.match(req).then((c) => c || fetch(req)));
});

// Web push: show the notification.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "eHive Circle";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/portal" },
    }),
  );
});

// Tapping a notification focuses an open tab or opens the target URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/portal";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const c of cls) {
        if ("focus" in c) { c.navigate(target).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
