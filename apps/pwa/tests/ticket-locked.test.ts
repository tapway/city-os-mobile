import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { ApiError, isTicketLocked, toApiErrorFromText } from '../src/lib/api';
import { classifyFailure, lockedNotice, syncQueue, enqueueMutation, getQueue, clearQueue } from '../src/lib/offline-queue';
import { staleConflictMessage } from '../src/lib/ticket-actions';
import { translate } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';

const LOCKED_BODY = JSON.stringify({ detail: { code: 'ticket_locked', message_en: 'This ticket is locked', message_bm: 'Tiket ini dikunci' } });

describe('ticket_locked detection', () => {
  it('recognises a 409 whose ErrorBody code is ticket_locked, from either shape', () => {
    expect(isTicketLocked(toApiErrorFromText(409, LOCKED_BODY))).toBe(true);
    expect(isTicketLocked(new ApiError(409, 'x', { detail: { code: 'ticket_locked' } }))).toBe(true);
  });
  it('does not confuse other 409s or other statuses', () => {
    expect(isTicketLocked(toApiErrorFromText(409, JSON.stringify({ detail: { code: 'invalid_transition' } })))).toBe(false);
    expect(isTicketLocked(toApiErrorFromText(422, LOCKED_BODY))).toBe(false);
    expect(isTicketLocked(new Error('x'))).toBe(false);
  });
  it('classifyFailure: locked is its own outcome; other 409 still drops', () => {
    expect(classifyFailure(409, 'ticket_locked')).toBe('locked');
    expect(classifyFailure(409)).toBe('drop');
    expect(classifyFailure(409, 'invalid_transition')).toBe('drop');
  });
  it('live path: the stale-ticket message is not used for a lock (the server bilingual text shows)', () => {
    expect(staleConflictMessage(toApiErrorFromText(409, LOCKED_BODY))).toBeNull();
    expect(staleConflictMessage(new ApiError(409, 'x'))).toEqual({ key: 'detail.err.stale' });
  });
});

describe('locked strings', () => {
  it('has the exact wording in both languages', () => {
    expect(en['offline.locked']).toBe('Ticket is locked by a supervisor; your update is saved and will be sent when it is unlocked');
    expect(ms['offline.locked']).toBeTruthy();
    expect(ms['offline.locked']).not.toBe(en['offline.locked']);
    expect(translate('ms', 'detail.locked')).not.toBe(translate('en', 'detail.locked'));
  });
});

describe('queue replay with ticket_locked', () => {
  beforeEach(async () => { await clearQueue(); });
  const queue = (uid = 'T-1', urls: string[] = ['/api/uploads/mobile-attachments/T-1/d/a.jpg']) =>
    enqueueMutation({ url: `/api/tickets/${uid}/status`, method: 'PATCH', user: 'ali', body: { status: 'RESOLVED', image_urls: urls } });
  const locked = () => new ApiError(409, 'locked', LOCKED_BODY);

  it('keeps the entry and its evidence (thrown error), marks it locked, reports it', async () => {
    await queue();
    const del = vi.fn();
    const res = await syncQueue(async () => { throw locked(); }, { username: 'ali', deleteEvidence: del });
    expect(res).toMatchObject({ synced: 0, failed: 1, dropped: 0, locked: 1 });
    expect(del).not.toHaveBeenCalled();
    const q = await getQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ locked: true });
    expect(lockedNotice(res)).toEqual({ key: 'offline.locked', vars: { n: 1 } });
  });

  it('keeps it too when the 409 arrives as a plain response', async () => {
    await queue();
    const res = await syncQueue(async () => new Response(LOCKED_BODY, { status: 409 }), { username: 'ali' });
    expect(res).toMatchObject({ dropped: 0, locked: 1 });
    expect(await getQueue()).toHaveLength(1);
  });

  it('later entries for the locked ticket wait; other tickets still send', async () => {
    await queue('T-1');
    await queue('T-1', []);
    await queue('T-2', []);
    const seen: string[] = [];
    const res = await syncQueue(async (url) => {
      seen.push(url);
      if (url.includes('T-1')) throw locked();
      return new Response('{}', { status: 200 });
    }, { username: 'ali' });
    expect(seen).toEqual(['/api/tickets/T-1/status', '/api/tickets/T-2/status']);
    expect(res).toMatchObject({ synced: 1, failed: 2, dropped: 0, locked: 1 });
    expect(await getQueue()).toHaveLength(2);
  });

  it('after the supervisor unlocks, the next sync (Send now) delivers it and clears the queue', async () => {
    await queue();
    await syncQueue(async () => { throw locked(); }, { username: 'ali' });
    const res = await syncQueue(async () => new Response('{}', { status: 200 }), { username: 'ali' });
    expect(res).toMatchObject({ synced: 1, failed: 0, dropped: 0 });
    expect(res.locked).toBeUndefined();
    expect(await getQueue()).toHaveLength(0);
  });

  it('a non-lock 409 is still dropped', async () => {
    await queue();
    const res = await syncQueue(async () => { throw new ApiError(409, 'x', JSON.stringify({ detail: { code: 'invalid_transition' } })); }, { username: 'ali', deleteEvidence: async () => undefined });
    expect(res).toMatchObject({ dropped: 1 });
    expect(await getQueue()).toHaveLength(0);
  });
});
