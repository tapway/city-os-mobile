import { describe, it, expect } from 'vitest';
import { listTicketsQuery, MAX_NOTE_LENGTH, MAX_QUERY_LENGTH } from '../src/lib/help-api';
import { clampNote, noteCounter } from '../src/lib/ticket-actions';

describe('limits (M-F3)', () => {
  it('constants match the server caps', () => {
    expect(MAX_NOTE_LENGTH).toBe(4000);
    expect(MAX_QUERY_LENGTH).toBe(200);
  });
  it('clamps q to 200 characters after trimming', () => {
    const qs = new URLSearchParams(listTicketsQuery({ q: ` ${'a'.repeat(300)} ` }));
    expect(qs.get('q')).toBe('a'.repeat(200));
  });
  it('leaves a short q alone and omits a blank one', () => {
    expect(new URLSearchParams(listTicketsQuery({ q: 'pokok' })).get('q')).toBe('pokok');
    expect(new URLSearchParams(listTicketsQuery({ q: '   ' })).has('q')).toBe(false);
  });
  it('clampNote cuts pasted text to 4000', () => {
    expect(clampNote('x'.repeat(5000))).toHaveLength(4000);
    expect(clampNote('ok')).toBe('ok');
  });
  it('counter reads used/limit', () => {
    expect(noteCounter('abc')).toBe('3/4000');
  });
});
