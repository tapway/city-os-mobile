import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  classifyFailure,
  syncNotice,
  syncQueue,
  enqueueMutation,
  getQueue,
  clearQueue,
} from '../src/lib/offline-queue';
import { ApiError } from '../src/lib/api';
import { staleConflictMessage } from '../src/lib/ticket-actions';

describe('classifyFailure: drop or retry', () => {
  it.each([400, 403, 404, 409, 410, 422])('drops %i', (s) => {
    expect(classifyFailure(s)).toBe('drop');
  });
  it.each([0, 408, 429, 500, 502, 503])('retries %i', (s) => {
    expect(classifyFailure(s)).toBe('retry');
  });
  it('retries a 401 until the token has been refreshed, then drops it', () => {
    expect(classifyFailure(401, { refreshed: false })).toBe('retry');
    expect(classifyFailure(401, { refreshed: true })).toBe('drop');
  });
});

describe('syncNotice', () => {
  it('is null when nothing was dropped', () => {
    expect(syncNotice({ synced: 2, failed: 1, dropped: 0 })).toBeNull();
    expect(syncNotice(null)).toBeNull();
  });
  it('reports the dropped count', () => {
    expect(syncNotice({ synced: 0, failed: 0, dropped: 2 })).toEqual({ key: 'offline.dropped', vars: { n: 2 } });
  });
});

describe('409 on a live update', () => {
  it('maps to the translated stale message', () => {
    expect(staleConflictMessage(new ApiError(409, 'Invalid transition'))).toEqual({ key: 'detail.err.stale' });
  });
  it('leaves other errors alone', () => {
    expect(staleConflictMessage(new ApiError(403, 'x'))).toBeNull();
    expect(staleConflictMessage(new Error('x'))).toBeNull();
  });
});

describe('syncQueue failure handling', () => {
  beforeEach(async () => {
    await clearQueue();
  });
  const queue = (urls: string[] = []) =>
    enqueueMutation({
      url: '/api/tickets/T-1/status',
      method: 'PATCH',
      body: { status: 'ASSIGNED', client_request_id: 'k1', image_urls: urls },
    });

  it('drops a 409 (apiFetch throws ApiError) and deletes its uploaded evidence', async () => {
    await queue(['/api/uploads/a.png', '/api/uploads/b.png']);
    const del = vi.fn().mockResolvedValue(undefined);
    const res = await syncQueue(async () => { throw new ApiError(409, 'stale'); }, { deleteEvidence: del });
    expect(res).toEqual({ synced: 0, failed: 0, dropped: 1 });
    expect(del.mock.calls.map((c) => c[0])).toEqual(['/api/uploads/a.png', '/api/uploads/b.png']);
    expect(await getQueue()).toHaveLength(0);
  });

  it('keeps 429 / 408 / 5xx / offline queued and does not delete evidence', async () => {
    await queue(['/api/uploads/a.png']);
    const del = vi.fn();
    for (const status of [429, 408, 503, 0]) {
      const res = await syncQueue(async () => { throw new ApiError(status, 'x'); }, { deleteEvidence: del });
      expect(res).toEqual({ synced: 0, failed: 1, dropped: 0 });
    }
    expect(del).not.toHaveBeenCalled();
    expect(await getQueue()).toHaveLength(1);
  });

  it('drops a 401 that persisted after apiFetch refreshed the token', async () => {
    await queue();
    const res = await syncQueue(async () => { throw new ApiError(401, 'Session expired'); });
    expect(res.dropped).toBe(1);
  });

  it('still counts a successful replay and survives an evidence-delete failure', async () => {
    await queue();
    await queue(['/x']);
    let n = 0;
    const res = await syncQueue(
      async () => {
        if (n++ === 0) return new Response('{}', { status: 200 });
        throw new ApiError(422, 'bad');
      },
      { deleteEvidence: async () => { throw new Error('boom'); } },
    );
    expect(res).toEqual({ synced: 1, failed: 0, dropped: 1 });
  });
});
