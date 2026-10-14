import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { actionButtons } from '../src/lib/ticket-actions';
import { registerPath, keyOfUrl, registerEvidence, chunk, MAX_EVIDENCE_PHOTOS } from '../src/lib/help-api';
import { submitEvidence, type EvidenceDeps } from '../src/lib/submit-evidence';
import { ApiError } from '../src/lib/api';
import { syncQueue, enqueueMutation, getQueue, clearQueue } from '../src/lib/offline-queue';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';

const view = (action: string) => ({ action, label: action, inputs: {} });
const file = (n: string) => new File(['x'], n, { type: 'image/jpeg' });
const KEY = 'mobile-attachments/T-1/20261003/ab12.jpg';

describe('Add evidence button', () => {
  it('shows only when the server offers upload_evidence', () => {
    expect(actionButtons([view('upload_evidence')]).map((b) => b.action)).toEqual(['upload_evidence']);
    expect(actionButtons([view('complete')]).map((b) => b.action)).not.toContain('upload_evidence');
    expect(actionButtons([])).toEqual([]);
  });
  it('is not a status change, needs no GPS, can queue offline, has a test id and bilingual label', () => {
    const b = actionButtons([view('upload_evidence')])[0]!;
    expect(b).toMatchObject({ status: null, needsOnline: false, testId: 'ticket-action-upload_evidence', needsPhoto: true, needsGps: false });
    expect(en[b.labelKey]).toBe('Add evidence');
    expect(ms[b.labelKey]).toBeTruthy();
    expect(ms[b.labelKey]).not.toBe(en[b.labelKey]);
  });
});

describe('paths', () => {
  it('register path and url->key', () => {
    expect(registerPath('T 1')).toBe('/api/v1/events/T%201/attachments/register');
    expect(keyOfUrl(`/api/uploads/${KEY}`)).toBe(KEY);
    expect(keyOfUrl(KEY)).toBe(KEY);
  });
});

function deps(over: Partial<EvidenceDeps> = {}): EvidenceDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    hasQueued: vi.fn(async () => false),
    upload: vi.fn(async (f: File) => ({ url: `/api/uploads/mobile-attachments/T-1/20261003/${f.name}` })),
    register: vi.fn(async () => [11, 12]),
    act: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => 1),
    ...over,
  } as never;
}
const input = { uid: 'T-1', user: 'ali', photos: [file('a.jpg'), file('b.jpg')] };

describe('submitEvidence (live)', () => {
  it('uploads, registers the keys, then runs upload_evidence with the ids', async () => {
    const d = deps();
    const r = await submitEvidence(d, input);
    expect(r.outcome).toBe('saved');
    expect(d.register).toHaveBeenCalledWith('T-1', [
      'mobile-attachments/T-1/20261003/a.jpg',
      'mobile-attachments/T-1/20261003/b.jpg',
    ]);
    expect(d.act).toHaveBeenCalledWith('T-1', [11, 12], undefined);
    expect(d.enqueue).not.toHaveBeenCalled();
  });
  it('requires at least one photo and a user', async () => {
    await expect(submitEvidence(deps(), { ...input, photos: [] })).rejects.toThrow();
    await expect(submitEvidence(deps(), { ...input, user: '' })).rejects.toThrow();
  });
  it('offline during upload queues the unsent blobs in order, keeps uploaded urls', async () => {
    let n = 0;
    const d = deps({ upload: vi.fn(async (f: File) => { if (n++ === 1) throw new ApiError(0, 'off'); return { url: `/api/uploads/mobile-attachments/T-1/20261003/${f.name}` }; }) });
    const r = await submitEvidence(d, input);
    expect(r.outcome).toBe('queued');
    const q = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(q).toMatchObject({ kind: 'evidence', method: 'POST', user: 'ali', url: '/api/v1/events/T-1/actions/upload_evidence' });
    expect(q.photos).toHaveLength(1);
    expect(q.body.image_urls).toHaveLength(1);
    expect(d.register).not.toHaveBeenCalled();
  });
  it('offline at register queues with urls (nothing registered yet)', async () => {
    const d = deps({ register: vi.fn(async () => { throw new ApiError(0, 'off'); }) });
    expect((await submitEvidence(d, input)).outcome).toBe('queued');
    const q = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(q.body.image_urls).toHaveLength(2);
    expect(q.attachment_ids).toBeUndefined();
    expect(d.remove).not.toHaveBeenCalled();
  });
  it('offline at the action keeps the registered ids so replay skips register', async () => {
    const d = deps({ act: vi.fn(async () => { throw new ApiError(0, 'off'); }) });
    expect((await submitEvidence(d, input)).outcome).toBe('queued');
    const q = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(q.attachment_ids).toEqual([11, 12]);
  });
  it('401 queues as queuedAuth', async () => {
    const d = deps({ register: vi.fn(async () => { throw new ApiError(401, 'x'); }) });
    expect((await submitEvidence(d, input)).outcome).toBe('queuedAuth');
  });
  it('a pending update for the ticket goes first: everything is queued as blobs', async () => {
    const d = deps({ hasQueued: vi.fn(async () => true) });
    expect((await submitEvidence(d, input)).outcome).toBe('queued');
    expect(d.upload).not.toHaveBeenCalled();
    expect((d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0].photos).toHaveLength(2);
  });
  it('a rejected register (400) deletes the uploaded objects and rethrows the server error', async () => {
    const err = new ApiError(400, 'bad key');
    const d = deps({ register: vi.fn(async () => { throw err; }) });
    await expect(submitEvidence(d, input)).rejects.toBe(err);
    expect(d.remove).toHaveBeenCalledTimes(2);
  });
  it('a rejected action (409) after registering does NOT delete the now-registered objects', async () => {
    const d = deps({ act: vi.fn(async () => { throw new ApiError(409, 'x'); }) });
    await expect(submitEvidence(d, input)).rejects.toBeInstanceOf(ApiError);
    expect(d.remove).not.toHaveBeenCalled();
  });
});

describe('replay of a queued evidence action', () => {
  beforeEach(async () => { await clearQueue(); });
  const queueIt = (extra: object = {}) =>
    enqueueMutation({
      url: '/api/v1/events/T-1/actions/upload_evidence',
      method: 'POST',
      kind: 'evidence',
      user: 'ali',
      body: { image_urls: [`/api/uploads/${KEY}`] },
      ...extra,
    } as never);

  it('registers the keys then posts the action with the returned ids, in order', async () => {
    await queueIt();
    const calls: [string, unknown][] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, JSON.parse(init.body as string)]);
      return url.endsWith('/register') ? new Response(JSON.stringify([{ id: 5 }]), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 200 });
    });
    const res = await syncQueue(fetchFn, { username: 'ali' });
    expect(res).toMatchObject({ synced: 1, failed: 0, dropped: 0 });
    expect(calls).toEqual([
      ['/api/v1/events/T-1/attachments/register', { kind: 'evidence', items: [{ key: KEY }] }],
      ['/api/v1/events/T-1/actions/upload_evidence', { attachment_ids: [5] }],
    ]);
    expect(await getQueue()).toHaveLength(0);
  });

  it('uploads queued blobs first, then registers, then acts', async () => {
    await queueIt({ body: { image_urls: [] }, photos: [{ blob: new Blob(['x'], { type: 'image/jpeg' }), name: 'a.jpg' }] });
    const order: string[] = [];
    const res = await syncQueue(
      async (url) => {
        order.push(url);
        return url.endsWith('/register') ? new Response(JSON.stringify([{ id: 9 }]), { status: 200 }) : new Response('{}', { status: 200 });
      },
      { username: 'ali', uploadPhoto: async () => { order.push('upload'); return { url: `/api/uploads/${KEY}` }; } },
    );
    expect(res.synced).toBe(1);
    expect(order).toEqual(['upload', '/api/v1/events/T-1/attachments/register', '/api/v1/events/T-1/actions/upload_evidence']);
  });

  it('a failed action keeps the registered ids; the retry skips register', async () => {
    await queueIt();
    let failAction = true;
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      if (url.endsWith('/register')) return new Response(JSON.stringify([{ id: 5 }]), { status: 200 });
      if (failAction) throw new ApiError(503, 'down');
      return new Response('{}', { status: 200 });
    };
    expect(await syncQueue(fetchFn, { username: 'ali' })).toMatchObject({ synced: 0, failed: 1 });
    expect((await getQueue())[0]).toMatchObject({ attachment_ids: [5] });
    failAction = false;
    urls.length = 0;
    expect(await syncQueue(fetchFn, { username: 'ali' })).toMatchObject({ synced: 1 });
    expect(urls).toEqual(['/api/v1/events/T-1/actions/upload_evidence']);
  });

  it('a permanent register rejection drops the entry and deletes the evidence', async () => {
    await queueIt();
    const del = vi.fn(async () => undefined);
    const res = await syncQueue(async () => { throw new ApiError(400, 'bad'); }, { username: 'ali', deleteEvidence: del });
    expect(res).toMatchObject({ dropped: 1 });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("another user's evidence entry is held, not sent", async () => {
    await queueIt({ user: 'siti' });
    const fetchFn = vi.fn();
    const res = await syncQueue(fetchFn, { username: 'ali' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(res.otherUser).toBe(1);
  });
});

describe('comment is sent with the action', () => {
  it('live: passes the typed comment to the action', async () => {
    const d = deps();
    await submitEvidence(d, { ...input, comment: 'rubbish cleared' });
    expect(d.act).toHaveBeenCalledWith('T-1', [11, 12], 'rubbish cleared');
  });
  it('queued: the comment rides on the entry', async () => {
    const d = deps({ act: vi.fn(async () => { throw new ApiError(0, 'off'); }) });
    await submitEvidence(d, { ...input, comment: 'note' });
    expect((d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0].comment).toBe('note');
  });
});

describe('locked on the live action (409 ticket_locked)', () => {
  it('queues WITH the registered ids, flagged locked, instead of throwing', async () => {
    const lockedErr = new ApiError(409, 'locked', JSON.stringify({ detail: { code: 'ticket_locked' } }));
    const d = deps({ act: vi.fn(async () => { throw lockedErr; }) });
    const r = await submitEvidence(d, input);
    expect(r.outcome).toBe('queuedLocked');
    const q = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(q).toMatchObject({ kind: 'evidence', attachment_ids: [11, 12], locked: true });
    expect(d.remove).not.toHaveBeenCalled();
  });
});

describe('10 items per register call', () => {
  it('constant and chunking', () => {
    expect(MAX_EVIDENCE_PHOTOS).toBe(10);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it.each([11, 23])('registerEvidence splits %i keys into <=10 calls and concatenates ids in order', async (n) => {
    const keys = Array.from({ length: n }, (_, i) => `mobile-attachments/T-1/d/${i}.jpg`);
    const sizes: number[] = [];
    let next = 100;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      const items = JSON.parse(init.body as string).items as unknown[];
      sizes.push(items.length);
      return new Response(JSON.stringify(items.map(() => ({ id: next++ }))), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    try {
      const ids = await registerEvidence('T-1', keys);
      expect(sizes.every((s) => s <= 10)).toBe(true);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(ids).toEqual(Array.from({ length: n }, (_, i) => 100 + i));
    } finally {
      globalThis.fetch = orig;
    }
  });
  it('offline replay registers 23 queued urls in 3 calls and acts once with all ids', async () => {
    await clearQueue();
    const urls = Array.from({ length: 23 }, (_, i) => `/api/uploads/mobile-attachments/T-1/d/${i}.jpg`);
    await enqueueMutation({ url: '/api/v1/events/T-1/actions/upload_evidence', method: 'POST', kind: 'evidence', user: 'ali', body: { image_urls: urls } } as never);
    const sizes: number[] = [];
    let next = 1;
    let actBody: any = null;
    const res = await syncQueue(async (url, init) => {
      const b = JSON.parse(init.body as string);
      if (url.endsWith('/register')) {
        sizes.push(b.items.length);
        return new Response(JSON.stringify(b.items.map(() => ({ id: next++ }))), { status: 200 });
      }
      actBody = b;
      return new Response('{}', { status: 200 });
    }, { username: 'ali' });
    expect(res.synced).toBe(1);
    expect(sizes).toEqual([10, 10, 3]);
    expect(actBody.attachment_ids).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
  });
});

describe('replay idempotency (action has no client_request_id upstream)', () => {
  beforeEach(async () => { await clearQueue(); });
  const entry = () => enqueueMutation({ url: '/api/v1/events/T-1/actions/upload_evidence', method: 'POST', kind: 'evidence', user: 'ali', attachment_ids: [5], body: { image_urls: [`/api/uploads/${KEY}`] } } as never);
  const invalid = JSON.stringify({ detail: { code: 'invalid_transition' } });

  it('409 invalid_transition + ticket now awaiting_evidence = already applied: synced, not dropped, queue cleared', async () => {
    await entry();
    const del = vi.fn();
    const res = await syncQueue(async (url) => {
      if (url === '/api/v1/events/T-1') return new Response(JSON.stringify({ workflow_state: 'awaiting_evidence' }), { status: 200 });
      return new Response(invalid, { status: 409 });
    }, { username: 'ali', deleteEvidence: del });
    expect(res).toMatchObject({ synced: 1, dropped: 0, failed: 0 });
    expect(del).not.toHaveBeenCalled();
    expect(await getQueue()).toHaveLength(0);
  });
  it('same when the 409 is thrown as an ApiError', async () => {
    await entry();
    const res = await syncQueue(async (url) => {
      if (url === '/api/v1/events/T-1') return new Response(JSON.stringify({ workflow_state: 'awaiting_evidence' }), { status: 200 });
      throw new ApiError(409, 'x', invalid);
    }, { username: 'ali' });
    expect(res).toMatchObject({ synced: 1, dropped: 0 });
  });
  it('409 invalid_transition with the ticket in another state is still a drop (registered objects kept)', async () => {
    await entry();
    const del = vi.fn();
    const res = await syncQueue(async (url) => {
      if (url === '/api/v1/events/T-1') return new Response(JSON.stringify({ workflow_state: 'closed' }), { status: 200 });
      return new Response(invalid, { status: 409 });
    }, { username: 'ali', deleteEvidence: del });
    expect(res).toMatchObject({ synced: 0, dropped: 1 });
    expect(del).not.toHaveBeenCalled();
  });
  it('if the state re-read fails, the entry stays queued (retry), not dropped', async () => {
    await entry();
    const res = await syncQueue(async (url) => {
      if (url === '/api/v1/events/T-1') throw new ApiError(503, 'down');
      return new Response(invalid, { status: 409 });
    }, { username: 'ali' });
    expect(res).toMatchObject({ dropped: 0, failed: 1 });
    expect(await getQueue()).toHaveLength(1);
  });
});
