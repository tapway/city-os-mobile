import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  STALE_CACHE_NAMES,
  shouldBypassServiceWorkerCache,
} from './lib/cache-policy';

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
