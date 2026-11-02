import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listNotifications, markAllRead, markRead, notificationText } from '../src/lib/notifications-api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('notifications API client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // apiFetch attaches a Bearer token when one is in memory; none here, and the
    // BFF answers 401 — but these tests assert the request, not the session.
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists newest-first with the unread filter and limit as query parameters', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], unread_count: 3 }));
    const page = await listNotifications({ unread: true, limit: 20 });
    expect(page.unread_count).toBe(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/notifications?unread=true&limit=20');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('marks one notification read with PATCH and returns the updated row', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 7, read_at: '2026-11-02T00:00:00Z' }));
    const row = await markRead(7);
    expect(row.id).toBe(7);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/notifications/7/read');
    expect(init.method).toBe('PATCH');
  });

  it('marks everything read with POST and reports how many changed', async () => {
    fetchMock.mockResolvedValueOnce(json({ updated: 4 }));
    await expect(markAllRead()).resolves.toEqual({ updated: 4 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/notifications/read-all');
    expect(init.method).toBe('POST');
  });

  it('picks the text for the active language and falls back to the other one', () => {
    const row = {
      id: 1, kind: 'assigned', ticket_uid: 'CH-1', title_en: 'Assigned', title_bm: 'Ditugaskan',
      body_en: 'Body EN', body_bm: 'Body BM', created_at: null, read_at: null,
    };
    expect(notificationText(row, 'ms')).toEqual({ title: 'Ditugaskan', body: 'Body BM' });
    expect(notificationText({ ...row, title_bm: null, body_bm: null }, 'ms'))
      .toEqual({ title: 'Assigned', body: 'Body EN' });
  });
});