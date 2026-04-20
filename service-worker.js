// service-worker.js — SouqSaaS PWA Service Worker
const CACHE_VERSION = "v1.0.0";
const STATIC_CACHE  = `souq-static-${CACHE_VERSION}`;
const DATA_CACHE    = `souq-data-${CACHE_VERSION}`;
const SYNC_QUEUE    = "souq-sync-queue";

const STATIC_ASSETS = [
  "/",
  "/app.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&display=swap",
];

// ── Install ────────────────────────────────────────────────
self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────
self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ─────────────────────────────────────────
self.addEventListener("fetch", (evt) => {
  const url = new URL(evt.request.url);

  // Static assets → Cache First
  if (
    STATIC_ASSETS.includes(evt.request.url) ||
    url.pathname.match(/\.(css|js|woff2?|png|svg|ico)$/)
  ) {
    evt.respondWith(
      caches.match(evt.request).then((cached) => cached || fetch(evt.request))
    );
    return;
  }

  // Supabase API → Network First, fall back to cache
  if (url.hostname.includes("supabase.co")) {
    evt.respondWith(networkFirst(evt.request));
    return;
  }

  // Everything else → Network with cache fallback
  evt.respondWith(networkFirst(evt.request));
});

async function networkFirst(request) {
  try {
    const res = await fetch(request.clone());
    if (res.ok && request.method === "GET") {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Return offline page for navigation requests
    if (request.mode === "navigate") {
      return caches.match("/app.html");
    }
    return new Response(JSON.stringify({ error: "Offline", offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Background Sync ────────────────────────────────────────
self.addEventListener("sync", (evt) => {
  if (evt.tag === "sync-queue") {
    evt.waitUntil(processSyncQueue());
  }
});

async function processSyncQueue() {
  const db = await openSyncDB();
  const queue = await db.getAll("queue");
  if (!queue.length) return;

  const clients = await self.clients.matchAll();

  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (res.ok) {
        await db.delete("queue", item.id);
        notifyClients(clients, { type: "SYNC_SUCCESS", itemId: item.id });
      } else {
        item.retries = (item.retries || 0) + 1;
        if (item.retries >= 5) {
          await db.delete("queue", item.id);
          notifyClients(clients, { type: "SYNC_FAILED", itemId: item.id, reason: "Max retries reached" });
        } else {
          await db.put("queue", item);
        }
      }
    } catch {
      item.retries = (item.retries || 0) + 1;
      await db.put("queue", item);
    }
  }
}

function notifyClients(clients, message) {
  clients.forEach((c) => c.postMessage(message));
}

// ── IndexedDB helper for sync queue ───────────────────────
function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("SouqSyncDB", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      resolve({
        getAll: (store) => new Promise((res, rej) => {
          const tx = db.transaction(store, "readonly");
          const r = tx.objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }),
        put: (store, item) => new Promise((res, rej) => {
          const tx = db.transaction(store, "readwrite");
          const r = tx.objectStore(store).put(item);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        }),
        delete: (store, key) => new Promise((res, rej) => {
          const tx = db.transaction(store, "readwrite");
          const r = tx.objectStore(store).delete(key);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        }),
      });
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Push Notifications (future) ────────────────────────────
self.addEventListener("push", (evt) => {
  const data = evt.data?.json() ?? { title: "إشعار جديد", body: "" };
  evt.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      dir: "rtl",
      lang: "ar",
    })
  );
});
