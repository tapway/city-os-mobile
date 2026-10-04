import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { apiProxy, pwaOptions } from './vite.shared';

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
    VitePWA(pwaOptions),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts,
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts,
    proxy: apiProxy,
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          tanstack: ['@tanstack/react-query', '@tanstack/react-router'],
        },
      },
    },
  },
});