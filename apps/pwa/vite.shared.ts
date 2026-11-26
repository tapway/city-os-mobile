import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * Both the dev server and `vite preview` (the production build served on :5173)
 * forward API and auth traffic to the BFF. `preview.proxy` defaults to
 * `server.proxy`; both are set explicitly from this one constant for clarity and
 * so they cannot drift.
 */
export const apiProxy = {
  '/api': { target: 'http://127.0.0.1:8002', changeOrigin: true },
  '/auth': { target: 'http://127.0.0.1:8002', changeOrigin: true },
};

export const pwaOptions: Partial<VitePWAOptions> = {
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectRegister: false,
    injectManifest: {
      swSrc: 'src/sw.ts',
      swDest: 'dist/sw.js',
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    },
    manifest: {
      name: 'City OS Operations',
      short_name: 'City OS',
      id: '/',
      start_url: '/?source=pwa',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#0B0F14',
      theme_color: '#0B0F14',
      categories: ['utilities', 'productivity'],
      icons: [
        { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Tickets', url: '/tickets' },
        { name: 'Clock In', url: '/attendance' },
      ],
    },
};
