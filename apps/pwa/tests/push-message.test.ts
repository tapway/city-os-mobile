import { describe, expect, it } from 'vitest';
import { pushToNotification, safeTicketPath } from '../src/lib/push-message';

describe('a push payload becomes a notification', () => {
  it('uses the officer language first and falls back to the other one', () => {
    const p = { title: 'Ticket assigned', body: 'CH-1 assigned', title_bm: 'Tiket ditugaskan', body_bm: 'CH-1 ditugaskan' };
    expect(pushToNotification(p, 'ms')).toMatchObject({ title: 'Tiket ditugaskan', body: 'CH-1 ditugaskan' });
    expect(pushToNotification(p, 'en')).toMatchObject({ title: 'Ticket assigned', body: 'CH-1 assigned' });
    expect(pushToNotification({ title: 'Only EN' }, 'ms')).toMatchObject({ title: 'Only EN' });
  });

  it('never produces an empty notification', () => {
    expect(pushToNotification({}, 'en')).toMatchObject({ title: 'City Help', body: '' });
  });

  it('carries the deep link and a stable tag so a retry replaces instead of stacking', () => {
    const n = pushToNotification({ title: 'T', url: '/ticket/CH-2026-00001', tag: 'ch-9' }, 'en');
    expect(n.data).toEqual({ url: '/ticket/CH-2026-00001' });
    expect(n.tag).toBe('ch-9');
  });

  it('accepts only an app-relative ticket path — never an absolute or protocol-relative URL', () => {
    expect(safeTicketPath('/ticket/CH-1')).toBe('/ticket/CH-1');
    expect(safeTicketPath('/tickets')).toBe('/tickets');
    expect(safeTicketPath('https://evil.example/ticket/1')).toBe('/tickets');
    expect(safeTicketPath('//evil.example/x')).toBe('/tickets');
    expect(safeTicketPath('javascript:alert(1)')).toBe('/tickets');
    expect(safeTicketPath(undefined)).toBe('/tickets');
  });

  it('drops an empty tag rather than sending one the phone cannot group', () => {
    expect(pushToNotification({ title: 'T', tag: '' }, 'en').tag).toBeUndefined();
  });
});