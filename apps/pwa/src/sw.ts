import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  STALE_CACHE_NAMES,
  shouldBypassServiceWorkerCache,
} from './lib/cache-policy';
import { pushToNotification } from './lib/push-message';
import { setResubscribeFlag } from './lib/push-flag';

// A new build must replace the old one without a second visit: take over
// straight away (registerType autoUpdate; main.tsx calls registerSW).
(self as any).skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Precache the app shell (vite-plugin-pwa injects the manifest). The manifest's
// start_url carries ?source=pwa and campaign links carry utm_*; neither should
// miss the precache.
precacheAndRoute((self as any).__WB_MANIFEST, {
  ignoreURLParametersMatching: [/^utm_/, /^source$/],
});

// Offline deep links (/tickets/CH-…) get the app shell; API and auth paths
// never do, so a failed fetch there stays a failure instead of returning HTML.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/auth\//],
  }),
);

// Authenticated traffic is never cached.
//
// Cache Storage is keyed by URL, not by who is signed in, so a cached
// /api/v1/events response is handed to whoever opens the app next — on a shared
// handset, one officer reading the previous officer's tickets. The previous
// NetworkFirst route also cached inconsistently: workbox's default
// cacheWillUpdate only stores responses whose Cache-Control says max-age, so a
// dated 200 was stored while an undated 201 was not.
registerRoute(
  ({ url }) => shouldBypassServiceWorkerCache(url.pathname),
  ({ request }) => fetch(request),
);

// Drop the api-cache left behind by an earlier version of this worker, so
// responses cached before this fix do not outlive it.
self.addEventListener('activate', (event) => {
  // Typed loosely: this file is compiled with the app's DOM lib, not the
  // webworker lib, so ExtendableEvent is not in scope.
  (event as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => (STALE_CACHE_NAMES as readonly string[]).includes(n))
            .map((n) => caches.delete(n)),
        ),
      ),
  );
});

// Bypass SW for HLS / WHEP streams (future camera work)
registerRoute(
  ({ url }) => url.pathname.includes('/stream') || url.pathname.includes('/hls'),
  ({ request }) => fetch(request),
);

// ---------------------------------------------------------------- Web Push
//
// A push arrives with the app closed, so the worker shows the notification
// itself. Text is chosen from the device locale rather than the in-app toggle:
// a service worker has no access to the page's language state.
self.addEventListener('push', (event) => {
  const ev = event as unknown as {
    data?: { json: () => unknown };
    waitUntil: (p: Promise<unknown>) => void;
  };
  let payload: Record<string, unknown> = {};
  try {
    payload = (ev.data?.json() as Record<string, unknown>) ?? {};
  } catch {
    // A payload we cannot parse still deserves a notification: it may be a
    // generic ping from the push service.
  }
  const lang = (self.navigator?.language || 'en').toLowerCase().startsWith('ms') ? 'ms' : 'en';
  const shown = pushToNotification(payload as never, lang);
  ev.waitUntil(
    (self as unknown as {
      registration: { showNotification: (title: string, options: NotificationOptions) => Promise<void> };
    }).registration.showNotification(shown.title, {
      body: shown.body,
      tag: shown.tag,
      data: shown.data,
      icon: '/icons/192.png',
      badge: '/icons/alerts-96.png',
    } as NotificationOptions),
  );
});

// Tapping the notification opens (or focuses) the ticket it is about.
self.addEventListener('notificationclick', (event) => {
  const ev = event as unknown as {
    notification: { close: () => void; data?: { url?: string } };
    waitUntil: (p: Promise<unknown>) => void;
  };
  ev.notification.close();
  const url = ev.notification.data?.url || '/tickets';
  ev.waitUntil(
    (async () => {
      const clients = (self as unknown as {
        clients: {
          matchAll: (o: { type: string; includeUncontrolled: boolean }) => Promise<Array<{ focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }>>;
          openWindow: (u: string) => Promise<unknown>;
        };
      }).clients;
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.navigate) {
          await client.focus();
          await client.navigate(url);
          return;
        }
      }
      await clients.openWindow(url);
    })(),
  );
});

// The browser rotated the subscription. Renewing it needs the user's access
// token, which only the page has, so leave a flag for the next app open.
self.addEventListener('pushsubscriptionchange', (event) => {
  const ev = event as unknown as { waitUntil: (p: Promise<unknown>) => void };
  ev.waitUntil(setResubscribeFlag());
});
