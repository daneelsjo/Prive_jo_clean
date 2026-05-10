// ─── JD Portaal Service Worker ───────────────────────────────────────────────
// Strategie:
//   • App Shell (HTML/CSS/JS/afbeeldingen) → Cache First + achtergrond update
//   • Firebase CDN (gstatic.com) → Network First met cache fallback
//   • Alles overig → Network First
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'jd-portaal-v1';

// Bestanden die meteen bij installatie worden gecached (app shell)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/CSS/main.css',
  '/CSS/components-menu.css',
  '/CSS/components-sidemenu.css',
  '/CSS/page-landing.css',
  '/src/services/auth.js',
  '/src/services/db.js',
  '/src/services/config.js',
  '/src/components/navigation.js',
  '/src/components/toast.js',
  '/src/modules/Workflow/workflow.html',
  '/src/modules/Workflow/workflow.css',
  '/src/modules/Workflow/workflow.js',
  '/src/modules/planner/plan.html',
  '/src/modules/planner/planner.css',
  '/src/modules/planner/planner.js',
  '/src/modules/tijdsregistratie/time.html',
  '/src/modules/tijdsregistratie/time.css',
  '/src/modules/notities/notes.html',
  '/src/modules/notities/page-notes.css',
  '/src/modules/sticknotes/sticknotes.html',
  '/src/modules/sticknotes/sticknotes.css',
  '/src/modules/agendabuilder/agendabuilder.html',
  '/src/modules/agendabuilder/agendabuilder.css',
  '/src/modules/settings/settings.html',
  '/src/modules/settings/settings.css',
  '/IMG/JD_Web_Solutions.jpg',
  '/icons/icon.svg',
  '/partials/header.html',
  '/partials/modals.html',
];

// ── Install: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Gebruik addAll maar vang fouten per item op zodat 1 fout niet alles blokkeert
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {
            // Stil mislukken voor optionele assets (b.v. nog niet gegenereerde iconen)
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: oude caches verwijderen ────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: verzoeken afhandelen ───────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Sla niet-GET verzoeken over
  if (request.method !== 'GET') return;

  // Firebase CDN (SDK bestanden) → Network First
  if (url.hostname === 'www.gstatic.com' || url.hostname.endsWith('.firebaseio.com') || url.hostname.endsWith('.googleapis.com')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // Chrome extensies / externe origins → gewoon doorgeven
  if (url.origin !== self.location.origin) return;

  // Eigen statische assets → Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategie: Stale-While-Revalidate ────────────────────────────────────────
// Geeft meteen de gecachte versie terug én update op de achtergrond
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

// ── Strategie: Network First met cache fallback ───────────────────────────────
async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

// ── Push notificaties (toekomstige uitbreiding) ───────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'JD Portaal', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'jd-portaal',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
