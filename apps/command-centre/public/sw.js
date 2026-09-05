/* global self, caches */
/*
 * MordomoOS service worker (plan Onda 3 §2): makes the Command Centre
 * installable and keeps the shell loading offline. Hashed build assets and
 * fonts are cached on first use; navigations go network-first and fall back
 * to the cached shell; the API is never cached (it is live state).
 */
const VERSION = "mordomo-shell-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// A push-style message from the page: show a system notification (the page
// asks for permission; the worker only displays what it is handed).
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "notify" || typeof data.title !== "string") return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: typeof data.body === "string" ? data.body : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { href: typeof data.href === "string" ? data.href : "/" },
    }),
  );
});

// Web Push from the server (encrypted end to end; see core/src/channels/webpush.ts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  if (!data || typeof data.title !== "string" || !data.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: typeof data.body === "string" ? data.body : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      requireInteraction: data.tone === "danger" || !!data.approvalId,
      data: { href: typeof data.href === "string" ? data.href : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const target = `${self.location.origin}/#${href.startsWith("/") ? href : `/${href}`}`;
      const existing = list.find((c) => "focus" in c);
      if (existing) {
        existing.navigate(target).catch(() => undefined);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
