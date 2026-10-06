import { describe, it, expect } from 'vitest';
import { listTicketsQuery } from '../src/lib/help-api';
import { defaultTicketFilter } from '../src/lib/ticket-filters';

describe('listTicketsQuery (M1 "My tickets")', () => {
  it('sends assignee=me when asked for my tickets', () => {
    const qs = new URLSearchParams(listTicketsQuery({ assignee: 'me', limit: 50 }));
    expect(qs.get('assignee')).toBe('me');
    expect(qs.get('limit')).toBe('50');
  });

  it('omits assignee otherwise, leaving other filters unchanged', () => {
    const qs = new URLSearchParams(listTicketsQuery({ status: ['ASSIGNED', 'VERIFIED'], q: ' pokok ' }));
    expect(qs.has('assignee')).toBe(false);
    expect(qs.get('status')).toBe('ASSIGNED,VERIFIED');
    expect(qs.get('q')).toBe('pokok');
    expect(qs.get('offset')).toBe('0');
  });

  it('combines assignee=me with a status filter', () => {
    const qs = new URLSearchParams(listTicketsQuery({ assignee: 'me', status: ['IN_PROGRESS'] }));
    expect(qs.get('assignee')).toBe('me');
    expect(qs.get('status')).toBe('IN_PROGRESS');
  });
});

describe('defaultTicketFilter', () => {
  it('selects Mine for handling_staff', () => {
    expect(defaultTicketFilter(['handling_staff'])).toBe('mine');
    expect(defaultTicketFilter(['x', 'handling_staff'])).toBe('mine');
  });
  it('selects All for everyone else, including unknown roles', () => {
    expect(defaultTicketFilter(['intake'])).toBe('all');
    expect(defaultTicketFilter([])).toBe('all');
    expect(defaultTicketFilter(undefined)).toBe('all');
  });
});

describe('engineer default (M-F4)', () => {
  it('uses To accept for handling staff when the probe found tickets', () => {
    expect(defaultTicketFilter(['handling_staff'], { toAcceptCount: 3 })).toBe('to_accept');
  });
  it('falls back to Mine when the probe is empty, failed, offline or pending', () => {
    expect(defaultTicketFilter(['handling_staff'], { toAcceptCount: 0 })).toBe('mine');
    expect(defaultTicketFilter(['handling_staff'], { toAcceptCount: null })).toBe('mine');
    expect(defaultTicketFilter(['handling_staff'])).toBe('mine');
  });
  it('never applies to other roles', () => {
    expect(defaultTicketFilter(['intake'], { toAcceptCount: 5 })).toBe('all');
  });
});
