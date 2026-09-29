import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import {
  STALE_CACHE_NAMES,
  shouldBypassServiceWorkerCache,
} from './lib/cache-policy';

// Precache the app shell (vite-plugin-pwa injects the manifest)
precacheAndRoute((self as any).__WB_MANIFEST || []);

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

// Listen for skip waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    (self as any).skipWaiting();
  }
});
