/* eHive Circle — PWA service worker.
   - App shell (portal.html) is precached; document navigations are
     network-first with the cached shell as the offline fallback.
   - Hashed build assets (/assets/, fonts, versioned root css/js) are
     cache-first — the URL hash is the revision, so no precache manifest is
     needed. Unversioned same-origin GETs are network-first so nothing can
     stick stale while online.
   - The API, tRPC, /metrics and Stripe are NEVER cached — always fresh.
   Bump CACHE to invalidate everything on a breaking change. */
const CACHE = "ehive-v4";
const SHELL = "/portal.html";
const MAX_ENTRY_BYTES = 8 * 1024 * 1024; // skip caching anything bigger
const MAX_ENTRIES = 200; // FIFO trim beyond this, so the cache can't grow forever

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* A new SW waits by default and takes over on the next load once old tabs are
   gone — the simple, safe update path. The page can also force an immediate
   takeover (e.g. from an "Update available" prompt) by posting SKIP_WAITING. */
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* Hashed/immutable assets: cache-first, network fills the cache on a miss. */
async function cacheFirst(req) {
  const hit = await caches.match(req, { cacheName: CACHE });
  if (hit) return hit;
  const res = await fetch(req);
  // "cors" responses are only ever stored for the Google Fonts caller below —
  // same-origin requests are always "basic".
  if (
    res.ok &&
    (res.type === "basic" || res.type === "cors") &&
    (Number(res.headers.get("content-length")) || 0) <= MAX_ENTRY_BYTES
  ) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
    await trimCache(cache);
  }
  return res;
}

/* Unversioned same-origin GETs: network-first, cache is the offline fallback
   (and is refreshed on every successful fetch, so it never goes stale). */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") {
      await cache.put(req, res.clone());
      await trimCache(cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  // Never intercept mutations — API POSTs / tRPC mutations always hit network.
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    // Cross-origin: cache Google Fonts only; Stripe and everything else go
    // straight to the network.
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(url.origin)) {
      event.respondWith(cacheFirst(req));
    }
    return;
  }

  const path = url.pathname;
  // Never cache the API (includes tRPC GETs) or metrics.
  if (path.startsWith("/api/") || path === "/metrics") return;

  // SPA navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(SHELL, { ignoreSearch: true }).then(r => r || caches.match(req))
      )
    );
    return;
  }

  // Hashed build assets + versioned static files: cache-first.
  if (isStaticAsset(path)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else same-origin (unversioned pages/images): network-first.
  event.respondWith(networkFirst(req));
});

function isStaticAsset(path) {
  return (
    path.startsWith("/assets/") ||
    path.startsWith("/fonts/") ||
    path.startsWith("/og/") ||
    /\.(woff2?|min\.css|min\.js)$/i.test(path) ||
    path === "/home.css" ||
    path === "/tokens.css" ||
    path === "/apps.css" ||
    path === "/fonts.css" ||
    path === "/styles.css"
  );
}

// Web push: show the notification.
self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "eHive Circle";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/portal" },
    })
  );
});

// Tapping a notification focuses an open tab or opens the target URL.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/portal";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(cls => {
        for (const c of cls) {
          if ("focus" in c) {
            c.navigate(target).catch(() => {});
            return c.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
