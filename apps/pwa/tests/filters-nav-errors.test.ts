import { describe, it, expect } from 'vitest';
import { listTicketsQuery } from '../src/lib/help-api';
import { TICKET_FILTERS, defaultTicketFilter } from '../src/lib/ticket-filters';
import { canCreateTickets } from '../src/lib/permissions';
import { errorDetail, ApiError, toApiErrorFromText } from '../src/lib/api';
import { translateMsg, msgOf, translate, initLang, setLang } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';

describe('I4: To accept filter', () => {
  it('sends state=dispatch', () => {
    expect(new URLSearchParams(listTicketsQuery({ state: 'dispatch' })).get('state')).toBe('dispatch');
    expect(new URLSearchParams(listTicketsQuery({})).has('state')).toBe(false);
  });
  it('is a filter with the M7 test id source and state=dispatch', () => {
    const f = TICKET_FILTERS.find((x) => x.id === 'to_accept');
    expect(f).toMatchObject({ state: 'dispatch', labelKey: 'tickets.filter.toAccept' });
    expect(en['tickets.filter.toAccept']).toBeTruthy();
    expect(ms['tickets.filter.toAccept']).toBeTruthy();
  });
  it('engineer default: To accept when it has items, else Mine', () => {
    expect(defaultTicketFilter(['handling_staff'], 3)).toBe('to_accept');
    expect(defaultTicketFilter(['handling_staff'], 0)).toBe('mine');
    expect(defaultTicketFilter(['handling_staff'], null)).toBe('mine');
    expect(defaultTicketFilter(['handling_staff'])).toBe('mine');
  });
  it('others stay on All regardless of count', () => {
    expect(defaultTicketFilter(['intake_officer'], 5)).toBe('all');
  });
});

describe('I5: create-ticket nav only for intake roles', () => {
  it.each([['help:tickets:intake'], ['intake_officer'], ['help:tickets:write'], ['*']])('shows for %s', (r) => {
    expect(canCreateTickets(['x', r])).toBe(true);
  });
  it('hides for the engineer and for no roles', () => {
    expect(canCreateTickets(['handling_staff'])).toBe(false);
    expect(canCreateTickets([])).toBe(false);
    expect(canCreateTickets(undefined)).toBe(false);
  });
});

describe('bilingual ErrorBody', () => {
  const body = JSON.stringify({ detail: { code: 'invalid_transition', message_en: 'Not allowed now', message_bm: 'Tidak dibenarkan sekarang' } });
  it('picks message_bm in ms and message_en in en', () => {
    expect(errorDetail(body, 'ms')).toBe('Tidak dibenarkan sekarang');
    expect(errorDetail(body, 'en')).toBe('Not allowed now');
  });
  it('falls back to the other language, then to the code', () => {
    expect(errorDetail({ detail: { code: 'x', message_en: 'E' } }, 'ms')).toBe('E');
    expect(errorDetail({ detail: { code: 'only_code' } }, 'en')).toBe('only_code');
  });
  it('still reads string and validation details', () => {
    expect(errorDetail({ detail: 'plain' }, 'en')).toBe('plain');
    expect(errorDetail({ detail: [{ loc: ['body', 'f'], msg: 'bad' }] }, 'en')).toBe('f: bad');
  });
  it('an ApiError built from the body uses the active language', () => {
    initLang(() => ({ getItem: () => 'ms', setItem: () => undefined }));
    expect(toApiErrorFromText(409, body).message).toBe('Tidak dibenarkan sekarang');
    setLang('en', () => ({ getItem: () => 'en', setItem: () => undefined }));
    expect(toApiErrorFromText(409, body).message).toBe('Not allowed now');
  });
});

describe('offline / session errors are translatable', () => {
  it('offline ApiError carries a message key', () => {
    const msg = msgOf(new ApiError(0, 'x', undefined, { key: 'err.offline' }));
    expect(translateMsg('ms', msg)).toBe(translate('ms', 'err.offline'));
    expect(translate('ms', 'err.offline')).not.toBe(translate('en', 'err.offline'));
  });
  it('has keys for session, forbidden, not found and server errors', () => {
    for (const k of ['err.offline', 'err.sessionExpired', 'err.forbidden', 'err.notFound', 'err.server'] as const) {
      expect(en[k]).toBeTruthy();
      expect(ms[k]).toBeTruthy();
    }
  });
});
