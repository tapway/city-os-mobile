import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  classifyFailure,
  syncNotice,
  authNotice,
  shouldRecord,
  syncQueue,
  enqueueMutation,
  getQueue,
  clearQueue,
} from '../src/lib/offline-queue';
import { ApiError } from '../src/lib/api';
import { onSignedIn, markSignedIn } from '../src/lib/auth';
import { staleConflictMessage } from '../src/lib/ticket-actions';

describe('classifyFailure: drop or retry', () => {
  it.each([400, 403, 404, 409, 410, 422, 499])('drops %i', (s) => {
    expect(classifyFailure(s)).toBe('drop');
  });
  it.each([0, 408, 429, 500, 502, 503])('retries %i', (s) => {
    expect(classifyFailure(s)).toBe('retry');
  });
  it('pauses for sign-in on 401, whether or not a refresh was tried', () => {
    expect(classifyFailure(401)).toBe('auth');
  });
});

describe('authNotice', () => {
  it('asks to sign in with the pending count when paused', () => {
    expect(authNotice({ synced: 0, failed: 3, dropped: 0, authRequired: true })).toEqual({
      key: 'offline.signInAgain', vars: { n: 3 },
    });
  });
  it('is null otherwise', () => {
    expect(authNotice({ synced: 1, failed: 1, dropped: 0 })).toBeNull();
    expect(authNotice(null)).toBeNull();
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

  it('401 pauses the sync and keeps every entry, evidence included', async () => {
    await queue(['/api/uploads/a.png']);
    await queue(['/api/uploads/b.png']);
    await queue();
    const del = vi.fn();
    const fetchFn = vi.fn(async () => { throw new ApiError(401, 'Session expired'); });
    const res = await syncQueue(fetchFn, { deleteEvidence: del });
    expect(res).toEqual({ synced: 0, failed: 3, dropped: 0, authRequired: true });
    expect(fetchFn).toHaveBeenCalledTimes(1); // paused, not hammering the server
    expect(del).not.toHaveBeenCalled();
    expect(await getQueue()).toHaveLength(3);
  });

  it('a bare 401 response pauses too', async () => {
    await queue();
    const res = await syncQueue(async () => new Response('', { status: 401 }));
    expect(res).toMatchObject({ dropped: 0, authRequired: true });
    expect(await getQueue()).toHaveLength(1);
  });

  it('after sign-in the paused entries replay and sync', async () => {
    await queue();
    await queue();
    await syncQueue(async () => { throw new ApiError(401, 'x'); });
    const flush = vi.fn(() => syncQueue(async () => new Response('{}', { status: 200 })));
    const off = onSignedIn(() => void flush());
    markSignedIn(true);
    await flush.mock.results[0]!.value;
    expect(flush).toHaveBeenCalledTimes(1);
    expect(await getQueue()).toHaveLength(0);
    markSignedIn(false); // sign-out does not trigger a sync
    expect(flush).toHaveBeenCalledTimes(1);
    off();
    markSignedIn(true);
    expect(flush).toHaveBeenCalledTimes(1);
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

describe('per-ticket ordering', () => {
  beforeEach(async () => {
    await clearQueue();
  });
  const add = (uid: string, status: string) =>
    enqueueMutation({ url: `/api/tickets/${uid}/status`, method: 'PATCH', body: { status, client_request_id: `${uid}-${status}` } });
  const sent: string[] = [];
  const fetchWith = (fail: Record<string, number>) => async (url: string, init: RequestInit) => {
    const status = JSON.parse(String(init.body)).status as string;
    sent.push(`${url.split('/')[3]}:${status}`);
    const code = fail[`${url.split('/')[3]}:${status}`];
    if (code !== undefined) throw new ApiError(code, 'x');
    return new Response('{}', { status: 200 });
  };
  beforeEach(() => { sent.length = 0; });

  it.each([503, 429, 408, 0])('holds later entries for a ticket whose earlier entry got %i', async (code) => {
    await add('T-1', 'ASSIGNED');
    await add('T-2', 'ASSIGNED');
    await add('T-1', 'IN_PROGRESS');
    const res = await syncQueue(fetchWith({ 'T-1:ASSIGNED': code }));
    expect(sent).toEqual(['T-1:ASSIGNED', 'T-2:ASSIGNED']); // Start not sent, other ticket still sent
    expect(res).toEqual({ synced: 1, failed: 2, dropped: 0 });
    const left = (await getQueue()).map((q) => (q.body as { status: string }).status);
    expect(left).toEqual(['ASSIGNED', 'IN_PROGRESS']); // order kept, nothing dropped
  });

  it('the next sync sends Accept then Start', async () => {
    await add('T-1', 'ASSIGNED');
    await add('T-1', 'IN_PROGRESS');
    await syncQueue(fetchWith({ 'T-1:ASSIGNED': 503 }));
    sent.length = 0;
    const res = await syncQueue(fetchWith({}));
    expect(sent).toEqual(['T-1:ASSIGNED', 'T-1:IN_PROGRESS']);
    expect(res).toMatchObject({ synced: 2, dropped: 0 });
    expect(await getQueue()).toHaveLength(0);
  });

  it('a dropped entry does not hold later ones for its ticket', async () => {
    await add('T-1', 'ASSIGNED');
    await add('T-1', 'IN_PROGRESS');
    await syncQueue(fetchWith({ 'T-1:ASSIGNED': 422 }));
    expect(sent).toEqual(['T-1:ASSIGNED', 'T-1:IN_PROGRESS']);
  });
});

describe('overlapping syncs', () => {
  beforeEach(async () => {
    await clearQueue();
  });
  it('a sync skipped because one is running says so and is not recorded', async () => {
    await enqueueMutation({ url: '/api/tickets/T-1/status', method: 'PATCH', body: { status: 'ASSIGNED' } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = syncQueue(async () => { await gate; return new Response('{}', { status: 200 }); });
    await new Promise((r) => setTimeout(r, 20));
    const second = await syncQueue(async () => new Response('{}'));
    expect(second.skipped).toBe(true);
    expect(shouldRecord(second)).toBe(false);
    release();
    const done = await first;
    expect(done.skipped).toBeUndefined();
    expect(shouldRecord(done)).toBe(true);
  });
});
