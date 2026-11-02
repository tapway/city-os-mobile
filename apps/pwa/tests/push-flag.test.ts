import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearResubscribeFlag, hasResubscribeFlag, setResubscribeFlag } from '../src/lib/push-flag';

/** Minimal CacheStorage stub: one cache, keyed by request URL. */
function fakeCaches() {
  const store = new Map<string, Response>();
  return {
    store,
    api: {
      open: async () => ({
        put: async (k: string, v: Response) => { store.set(k, v); },
        match: async (k: string) => store.get(k),
        delete: async (k: string) => store.delete(k),
      }),
    },
  };
}

describe('the service-worker → app resubscribe flag', () => {
  let fake: ReturnType<typeof fakeCaches>;
  beforeEach(() => {
    fake = fakeCaches();
    vi.stubGlobal('caches', fake.api);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is absent until the service worker sets it', async () => {
    await expect(hasResubscribeFlag()).resolves.toBe(false);
    await setResubscribeFlag();
    await expect(hasResubscribeFlag()).resolves.toBe(true);
  });

  it('clears after the app has renewed the subscription', async () => {
    await setResubscribeFlag();
    await clearResubscribeFlag();
    await expect(hasResubscribeFlag()).resolves.toBe(false);
  });

  it('treats unavailable storage as "nothing to do" instead of throwing', async () => {
    vi.stubGlobal('caches', { open: async () => { throw new Error('denied'); } });
    await expect(hasResubscribeFlag()).resolves.toBe(false);
    await expect(setResubscribeFlag()).resolves.toBeUndefined();
  });
});