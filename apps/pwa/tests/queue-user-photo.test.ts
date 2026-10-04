import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  syncQueue,
  enqueueMutation,
  getQueue,
  clearQueue,
  hasQueuedForTicket,
  logoutWarning,
  otherUserNotice,
} from '../src/lib/offline-queue';
import { ApiError } from '../src/lib/api';

const ok = async () => new Response('{}', { status: 200 });
const photo = (name = 'a.jpg') => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), name });

describe('I2: entries are stamped with the signed-in user', () => {
  beforeEach(async () => { await clearQueue(); });

  it('stores the username given at enqueue', async () => {
    await enqueueMutation({ url: '/api/tickets/T-1/status', method: 'PATCH', body: {}, user: 'ali' });
    expect((await getQueue())[0]?.user).toBe('ali');
  });

  it('only flushes the current user entries and holds the others', async () => {
    await enqueueMutation({ url: '/api/tickets/T-1/status', method: 'PATCH', body: { n: 1 }, user: 'ali' });
    await enqueueMutation({ url: '/api/tickets/T-2/status', method: 'PATCH', body: { n: 2 }, user: 'budi' });
    const fetchFn = vi.fn(ok);
    const res = await syncQueue(fetchFn, { username: 'budi' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/tickets/T-2/status');
    expect(res).toMatchObject({ synced: 1, dropped: 0, otherUser: 1 });
    const left = await getQueue();
    expect(left).toHaveLength(1);
    expect(left[0]?.user).toBe('ali');
  });

  it('holds stamped entries when the current user is unknown', async () => {
    await enqueueMutation({ url: '/api/tickets/T-1/status', method: 'PATCH', body: {}, user: 'ali' });
    const fetchFn = vi.fn(ok);
    await syncQueue(fetchFn, {});
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('still flushes an unstamped legacy entry', async () => {
    await enqueueMutation({ url: '/api/tickets/T-1/status', method: 'PATCH', body: {} });
    const res = await syncQueue(ok, { username: 'ali' });
    expect(res.synced).toBe(1);
  });

  it('warns on logout only when updates are pending', () => {
    expect(logoutWarning(0)).toBeNull();
    expect(logoutWarning(2)).toEqual({ key: 'app.signOutPending', vars: { n: 2 } });
  });

  it('tells the user how many other-user updates are waiting', () => {
    expect(otherUserNotice({ synced: 0, failed: 0, dropped: 0, otherUser: 2 })).toEqual({
      key: 'offline.otherUser', vars: { n: 2 },
    });
    expect(otherUserNotice({ synced: 0, failed: 0, dropped: 0 })).toBeNull();
    expect(otherUserNotice(null)).toBeNull();
  });
});

describe('offline Complete with a photo: blob queued, uploaded before the PATCH', () => {
  beforeEach(async () => { await clearQueue(); });
  const enqueue = (extra: object = {}) =>
    enqueueMutation({
      url: '/api/tickets/T-1/status', method: 'PATCH', user: 'ali',
      body: { status: 'RESOLVED', client_request_id: 'k1' },
      photos: [photo('a.jpg'), photo('b.jpg')],
      ...extra,
    });

  it('keeps the blob in IndexedDB with the entry', async () => {
    await enqueue();
    const [q] = await getQueue();
    expect(q?.photos).toHaveLength(2);
    expect(q?.photos?.[0]?.name).toBe('a.jpg');
    expect(q?.photos?.[0]?.blob.size).toBe(1);
  });

  it('uploads each photo for the ticket, then PATCHes with the urls', async () => {
    await enqueue();
    const order: string[] = [];
    const uploadPhoto = vi.fn(async (p: { name: string }, uid: string) => {
      order.push(`upload:${uid}:${p.name}`);
      return { url: `/api/uploads/${p.name}` };
    });
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => {
      order.push('patch');
      expect(JSON.parse(String(init.body)).image_urls).toEqual(['/api/uploads/a.jpg', '/api/uploads/b.jpg']);
      return new Response('{}', { status: 200 });
    });
    const res = await syncQueue(fetchFn, { username: 'ali', uploadPhoto });
    expect(order).toEqual(['upload:T-1:a.jpg', 'upload:T-1:b.jpg', 'patch']);
    expect(res).toMatchObject({ synced: 1, dropped: 0 });
    expect(await getQueue()).toHaveLength(0); // blob gone with the entry
  });

  it('does not re-upload after the PATCH is retried', async () => {
    await enqueue();
    const uploadPhoto = vi.fn(async (p: { name: string }) => ({ url: `/api/uploads/${p.name}` }));
    await syncQueue(async () => { throw new ApiError(503, 'x'); }, { username: 'ali', uploadPhoto });
    const [q] = await getQueue();
    expect(q?.photos ?? []).toHaveLength(0);
    expect((q?.body as { image_urls: string[] }).image_urls).toHaveLength(2);
    await syncQueue(ok, { username: 'ali', uploadPhoto });
    expect(uploadPhoto).toHaveBeenCalledTimes(2);
  });

  it('a failed upload (offline) keeps the blob queued and the PATCH unsent', async () => {
    await enqueue();
    const fetchFn = vi.fn(ok);
    const res = await syncQueue(fetchFn, {
      username: 'ali',
      uploadPhoto: async () => { throw new ApiError(0, 'offline'); },
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(res).toMatchObject({ synced: 0, failed: 1 });
    expect((await getQueue())[0]?.photos).toHaveLength(2);
  });

  it('upload 401 pauses for sign-in and keeps the blob', async () => {
    await enqueue();
    const res = await syncQueue(ok, {
      username: 'ali',
      uploadPhoto: async () => { throw new ApiError(401, 'x'); },
    });
    expect(res).toMatchObject({ authRequired: true });
    expect((await getQueue())[0]?.photos).toHaveLength(2);
  });

  it('a dropped update deletes the evidence it uploaded and the blob', async () => {
    await enqueue();
    const del = vi.fn().mockResolvedValue(undefined);
    const res = await syncQueue(async () => { throw new ApiError(409, 'stale'); }, {
      username: 'ali',
      deleteEvidence: del,
      uploadPhoto: async (p) => ({ url: `/api/uploads/${p.name}` }),
    });
    expect(res).toMatchObject({ dropped: 1 });
    expect(del.mock.calls.map((c) => c[0])).toEqual(['/api/uploads/a.jpg', '/api/uploads/b.jpg']);
    expect(await getQueue()).toHaveLength(0);
  });
});

describe('a live action behind queued entries', () => {
  beforeEach(async () => { await clearQueue(); });
  it('hasQueuedForTicket finds entries by ticket uid', async () => {
    await enqueueMutation({ url: '/api/tickets/T-1/status', method: 'PATCH', body: {} });
    expect(await hasQueuedForTicket('T-1')).toBe(true);
    expect(await hasQueuedForTicket('T-2')).toBe(false);
  });
});
