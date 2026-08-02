import { describe, it, expect, beforeEach } from 'vitest';
import { enqueueMutation, getQueue, clearQueue } from '../src/lib/offline-queue';
import 'fake-indexeddb/auto';

describe('offline queue', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it('enqueues a mutation when offline', async () => {
    const id = await enqueueMutation({
      url: '/api/v1/events',
      method: 'POST',
      body: { title: 'Test ticket' },
    });
    expect(id).toBeGreaterThan(0);
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.url).toBe('/api/v1/events');
  });

  it('clears queue after successful sync', async () => {
    await enqueueMutation({
      url: '/api/v1/events',
      method: 'POST',
      body: { title: 'Test' },
    });
    await clearQueue();
    const queue = await getQueue();
    expect(queue).toHaveLength(0);
  });

  it('multiple mutations are queued in order', async () => {
    await enqueueMutation({ url: '/a', method: 'POST', body: { seq: 1 } });
    await enqueueMutation({ url: '/b', method: 'POST', body: { seq: 2 } });
    const queue = await getQueue();
    expect(queue).toHaveLength(2);
  });
});