import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Hosts allowed to reach the dev server.
 *
 * Vite 6 rejects requests whose Host header it does not recognise, which breaks
 * access through a reverse proxy / Tailscale tunnel with a 403 "Blocked
 * request" page (the proxy forwards the tunnel hostname, not localhost).
 * The tailnet suffix is allowed by default and extra hosts can be supplied
 * through VITE_ALLOWED_HOSTS (comma separated) without touching this file.
 */
const allowedHosts = [
  'localhost',
  '127.0.0.1',
  '.ts.net',
  ...(process.env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
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
    }),
  ],
  server: {
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': { target: 'http://localhost:8002', changeOrigin: true },
      '/auth': { target: 'http://localhost:8002', changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    allowedHosts,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          tanstack: ['@tanstack/react-query', '@tanstack/react-router'],
        },
      },
    },
  },
});