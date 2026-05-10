// ─── JD Portaal Service Worker ───────────────────────────────────────────────

// Firebase Messaging (achtergrond push notificaties via FCM)
importScripts('https://www.gstatic.com/firebasejs/10.5.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.5.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBkVwWdSNwlPWjeNT_BRb7pFzkeVB2VT3Q",
    authDomain: "prive-jo.firebaseapp.com",
    projectId: "prive-jo",
    messagingSenderId: "849510732758",
    appId: "1:849510732758:web:6c506a7f7adcc5c1310a77"
});

const messaging = firebase.messaging();

// Achtergrond push-berichten tonen als de app niet open staat
messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'JD Portaal', {
        body: n.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: payload.data?.tag || 'jd-portaal',
        data: { url: payload.data?.url || '/' }
    });
});

// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'jd-portaal-v2';

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
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/partials/header.html',
  '/partials/modals.html',
];

// ── Install: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => {}))
      )
    )
    // Geen self.skipWaiting() — nieuwe SW wacht tot gebruiker "Vernieuwen" klikt
  );
});

// ── Activate: oude caches verwijderen ────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Message: update activeren op verzoek van de pagina ───────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Fetch: verzoeken afhandelen ───────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.hostname === 'www.gstatic.com' || url.hostname.endsWith('.firebaseio.com') || url.hostname.endsWith('.googleapis.com')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(request));
});

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

async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

// ── Notificatie aanklikken → app openen ──────────────────────────────────────
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
