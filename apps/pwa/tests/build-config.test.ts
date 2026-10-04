import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../vite.config';
import { pwaOptions, apiProxy } from '../vite.shared';

const EXPECTED_PROXY = {
  '/api': { target: 'http://127.0.0.1:8002', changeOrigin: true },
  '/auth': { target: 'http://127.0.0.1:8002', changeOrigin: true },
};

describe('vite config: production build (M6)', () => {
  it('server and preview share the same API proxy', () => {
    expect(apiProxy).toEqual(EXPECTED_PROXY);
    expect(config.server?.proxy).toEqual(EXPECTED_PROXY);
    expect(config.preview?.proxy).toEqual(EXPECTED_PROXY);
  });
  it('binds 127.0.0.1 with a strict port on both', () => {
    for (const s of [config.server, config.preview]) {
      expect(s?.host).toBe('127.0.0.1');
      expect(s?.strictPort).toBe(true);
      expect(s?.port).toBe(5173);
    }
  });
  it('keeps the allowed hosts on preview', () => {
    const hosts = config.preview?.allowedHosts as string[];
    expect(hosts).toContain('.ts.net');
  });
  it('auto-updates the service worker and registers it from main.tsx', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate');
    expect(pwaOptions.injectRegister).toBe(false);
    expect(config.build?.sourcemap).toBe('hidden');
  });
});

describe('service worker + registration source (M6)', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, '../src', f), 'utf8');
  it('sw.ts activates immediately and serves the shell for navigations', () => {
    const sw = src('sw.ts');
    expect(sw).toMatch(/skipWaiting\(\)/);
    expect(sw).toMatch(/clientsClaim\(\)/);
    expect(sw).toMatch(/cleanupOutdatedCaches\(\)/);
    expect(sw).toMatch(/createHandlerBoundToURL\('\/index\.html'\)/);
    expect(sw).toMatch(/denylist:\s*\[\/\^\\\/api\\\//);
    expect(sw).toMatch(/\/\^\\\/auth\\\//);
    expect(sw).toMatch(/ignoreURLParametersMatching:\s*\[\/\^utm_\/,\s*\/\^source\$\/\]/);
    expect(sw).not.toMatch(/SKIP_WAITING/);
  });
  it('main.tsx registers the worker immediately', () => {
    const main = src('main.tsx');
    expect(main).toContain("from 'virtual:pwa-register'");
    expect(main).toMatch(/registerSW\(\{\s*immediate:\s*true\s*\}\)/);
    expect(main).toContain('/// <reference types="vite-plugin-pwa/client" />');
  });
  it('workbox-core and workbox-window are explicit dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.devDependencies['workbox-core']).toBeTruthy();
    // virtual:pwa-register imports workbox-window; without it the build fails.
    expect(pkg.devDependencies['workbox-window']).toBeTruthy();
  });
});
