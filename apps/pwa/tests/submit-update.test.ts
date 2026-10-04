import { describe, it, expect, vi } from 'vitest';
import { submitStatusUpdate, type SubmitDeps } from '../src/lib/submit-update';
import { ApiError, shouldQueue } from '../src/lib/api';

const request = { path: '/api/tickets/T-1/status', body: { status: 'RESOLVED', client_request_id: 'k' } };
const file = (n: string) => new File(['x'], n, { type: 'image/jpeg' });

function deps(over: Partial<SubmitDeps> = {}): SubmitDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    hasQueued: vi.fn(async () => false),
    upload: vi.fn(async (f: File) => ({ url: `/api/uploads/${f.name}` })),
    patch: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => 1),
    ...over,
  } as never;
}

describe('shouldQueue', () => {
  it('queues for offline and for 401, not for other 4xx', () => {
    expect(shouldQueue(new ApiError(0, 'x'))).toBe(true);
    expect(shouldQueue(new ApiError(401, 'x'))).toBe(true);
    expect(shouldQueue(new ApiError(409, 'x'))).toBe(false);
    expect(shouldQueue(new ApiError(422, 'x'))).toBe(false);
  });
});

describe('submitStatusUpdate', () => {
  it('saves live when everything works', async () => {
    const d = deps();
    const r = await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg')] });
    expect(r.outcome).toBe('saved');
    expect(d.patch).toHaveBeenCalledOnce();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('I3: a 401 on the PATCH enqueues and keeps (does not delete) the evidence', async () => {
    const d = deps({ patch: vi.fn(async () => { throw new ApiError(401, 'Session expired'); }) });
    const r = await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg')] });
    expect(r.outcome).toBe('queuedAuth');
    expect(d.remove).not.toHaveBeenCalled();
    const queued = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(queued.body.image_urls).toEqual(['/api/uploads/a.jpg']);
  });

  it('a 401 during photo upload queues the blobs themselves', async () => {
    const d = deps({ upload: vi.fn(async () => { throw new ApiError(401, 'x'); }) });
    const r = await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg')] });
    expect(r.outcome).toBe('queuedAuth');
    const queued = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(queued.photos).toHaveLength(1);
    expect(d.patch).not.toHaveBeenCalled();
  });

  it('offline during upload: queues the unsent photos as blobs, keeps uploaded urls', async () => {
    let n = 0;
    const d = deps({ upload: vi.fn(async (f: File) => { if (n++ === 1) throw new ApiError(0, 'off'); return { url: `/api/uploads/${f.name}` }; }) });
    const r = await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg'), file('b.jpg')] });
    expect(r.outcome).toBe('queued');
    const queued = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(queued.body.image_urls).toEqual(['/api/uploads/a.jpg']);
    expect(queued.photos.map((p: { name: string }) => p.name)).toEqual(['b.jpg']);
  });

  it('a 4xx rejection deletes the uploaded evidence and rethrows', async () => {
    const d = deps({ patch: vi.fn(async () => { throw new ApiError(409, 'stale'); }) });
    await expect(submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg')] })).rejects.toMatchObject({ status: 409 });
    expect(d.remove).toHaveBeenCalledWith('/api/uploads/a.jpg');
  });

  it('enqueues behind existing queued entries without touching the network', async () => {
    const d = deps({ hasQueued: vi.fn(async () => true) });
    const r = await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg')] });
    expect(r.outcome).toBe('queued');
    expect(d.patch).not.toHaveBeenCalled();
    expect(d.upload).not.toHaveBeenCalled();
    const queued = (d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(queued.photos).toHaveLength(1);
    expect(queued.url).toBe(request.path);
  });
});

describe('queued entries always have an owner', () => {
  it('stamps the user captured at the start of the mutation', async () => {
    const d = deps({ patch: vi.fn(async () => { throw new ApiError(401, 'Session expired'); }) });
    await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [] });
    expect((d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0].user).toBe('ali');
  });
  it('stamps the owner on every queued path (offline, behind-queue, upload failure)', async () => {
    for (const d of [
      deps({ patch: vi.fn(async () => { throw new ApiError(0, 'off'); }) }),
      deps({ hasQueued: vi.fn(async () => true) }),
      deps({ upload: vi.fn(async () => { throw new ApiError(401, 'x'); }) }),
    ]) {
      await submitStatusUpdate(d, { uid: 'T-1', request, user: 'ali', photos: [file('a.jpg')] });
      expect((d.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0].user).toBe('ali');
    }
  });
  it('refuses to queue an unowned entry from a live path', async () => {
    const d = deps({ patch: vi.fn(async () => { throw new ApiError(401, 'x'); }) });
    await expect(submitStatusUpdate(d, { uid: 'T-1', request, user: '', photos: [] })).rejects.toBeTruthy();
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});
