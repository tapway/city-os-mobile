import { describe, it, expect } from 'vitest';
import {
  actionButtons,
  statusForAction,
  needSupportPath,
  buildActionUpdate,
} from '../src/lib/ticket-actions';
import { statusUpdateRequest } from '../src/lib/help-api';

/** Shape copied from City Help app/core/actions.py::_view (returned in ticket_view.py:79). */
const view = (action: string, label: string) => ({
  action, label, label_key: `actions.${action}`, kind: 'fsm', danger: false, confirm: false, inputs: {},
});

const FIXTURES = {
  dispatch: [view('accept', 'Accept'), view('escalate', 'Escalate')],
  accepted: [view('start', 'Start Work')],
  inProgress: [view('need_support', 'Need Support'), view('complete', 'Complete'), view('add_note', 'Add note')],
  waiting: [view('resume', 'Resume')],
  closed: [view('close', 'Close'), view('void', 'Void')],
};

const names = (a: unknown) => actionButtons(a).map((b) => b.action);

describe('actionButtons: only what the server offers', () => {
  it('dispatch -> Accept only (escalate is not a field action)', () => {
    expect(names(FIXTURES.dispatch)).toEqual(['accept']);
  });
  it('accepted -> Start work', () => expect(names(FIXTURES.accepted)).toEqual(['start']));
  it('in_progress -> Submit resolution + Need support, in fixed order', () => {
    expect(names(FIXTURES.inProgress)).toEqual(['complete', 'need_support']);
  });
  it('waiting_for_support -> Resume', () => expect(names(FIXTURES.waiting)).toEqual(['resume']));
  it('never offers Close, even when the server lists it', () => {
    expect(names(FIXTURES.closed)).toEqual([]);
  });
  it('missing / malformed available_actions -> no buttons', () => {
    expect(names(undefined)).toEqual([]);
    expect(names(null)).toEqual([]);
    expect(names([{ nope: 1 }, 42])).toEqual([]);
  });
  it('exposes the M7 test ids', () => {
    const all = actionButtons([view('accept', ''), view('start', ''), view('resume', ''), view('complete', ''), view('need_support', '')]);
    expect(all.map((b) => b.testId).sort()).toEqual(
      ['ticket-action-accept', 'ticket-action-complete', 'ticket-action-need_support', 'ticket-action-resume', 'ticket-action-start'],
    );
  });
  it('marks only need_support as non-status and offline-disabled', () => {
    const all = actionButtons([view('accept', ''), view('need_support', '')]);
    expect(all.find((b) => b.action === 'accept')).toMatchObject({ status: 'ASSIGNED', needsOnline: false });
    expect(all.find((b) => b.action === 'need_support')).toMatchObject({ status: null, needsOnline: true });
  });
});

describe('status mapping', () => {
  it('maps actions to the legacy status', () => {
    expect(statusForAction('accept')).toBe('ASSIGNED');
    expect(statusForAction('start')).toBe('IN_PROGRESS');
    expect(statusForAction('resume')).toBe('IN_PROGRESS');
    expect(statusForAction('complete')).toBe('RESOLVED');
    expect(statusForAction('need_support')).toBeNull();
  });
});

describe('request building', () => {
  it('need_support posts to the actions endpoint', () => {
    expect(needSupportPath('TKT 1/2')).toBe('/api/v1/events/TKT%201%2F2/actions/need_support');
  });
  it('carries GPS and a fresh client_request_id each time, queueable as-is', () => {
    const a = buildActionUpdate('accept', { actor: 'eng', lat: 1.4927, lng: 103.7414, note: 'n' });
    const b = buildActionUpdate('accept', { actor: 'eng', lat: 1.4927, lng: 103.7414, note: 'n' });
    expect(a.status).toBe('ASSIGNED');
    expect(a.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.client_request_id).not.toBe(b.client_request_id);
    const { path, body } = statusUpdateRequest('T-1', a);
    expect(path).toBe('/api/tickets/T-1/status?lat=1.4927&lng=103.7414');
    expect(body).toMatchObject({ status: 'ASSIGNED', actor: 'eng', client_request_id: a.client_request_id });
  });
  it('refuses to build a status update for need_support', () => {
    expect(() => buildActionUpdate('need_support', { actor: 'e', lat: 1, lng: 2 })).toThrow();
  });
});
