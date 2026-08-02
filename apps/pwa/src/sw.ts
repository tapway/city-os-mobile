import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache the app shell (vite-plugin-pwa injects the manifest)
precacheAndRoute((self as any).__WB_MANIFEST || []);

// API GET — stale-while-revalidate, 24h
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 })],
  })
);

// Bypass SW for HLS / WHEP streams (future camera work)
registerRoute(
  ({ url }) => url.pathname.includes('/stream') || url.pathname.includes('/hls'),
  ({ request }) => fetch(request)
);

// Listen for skip waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    (self as any).skipWaiting();
  }
});