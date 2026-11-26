import { describe, it, expect } from 'vitest';
import { resolveDefaultView, type DefaultView } from '../src/lib/ticket-filters';

const eng = ['handling_staff'];
const pending = { settled: false, count: null };

/** Drive the view like tickets.tsx does: feed probe states, carrying the latch forward. */
function run(roles: string[], states: { settled: boolean; count: number | null }[]) {
  let latched: DefaultView | null = null;
  return states.map((p) => {
    const r = resolveDefaultView(latched, roles, p);
    latched = r.latched;
    return r;
  });
}

describe('resolveDefaultView (probe wiring)', () => {
  it('pending probe: Mine shown, loading (skeleton), nothing latched', () => {
    expect(run(eng, [pending])[0]).toEqual({ view: 'mine', latched: null, probing: true });
  });
  it('resolved non-empty: To accept', () => {
    expect(run(eng, [pending, { settled: true, count: 3 }]).map((r) => r.view)).toEqual(['mine', 'to_accept']);
  });
  it.each([
    ['empty', { settled: true, count: 0 }],
    ['failed / offline (no count)', { settled: true, count: null }],
  ])('resolved %s: Mine', (_n, p) => {
    const r = run(eng, [pending, p]);
    expect(r[1]).toEqual({ view: 'mine', latched: 'mine', probing: false });
  });
  it('a later refetch does not flip the view (accepting the last ticket stays on To accept)', () => {
    const r = run(eng, [pending, { settled: true, count: 1 }, { settled: true, count: 0 }, { settled: false, count: null }]);
    expect(r.map((x) => x.view)).toEqual(['mine', 'to_accept', 'to_accept', 'to_accept']);
    expect(r[3]!.probing).toBe(false);
  });
  it('a new dispatch ticket does not flip a latched Mine to To accept', () => {
    const r = run(eng, [pending, { settled: true, count: 0 }, { settled: true, count: 4 }]);
    expect(r.map((x) => x.view)).toEqual(['mine', 'mine', 'mine']);
  });
  it('non-engineers: All, never probing', () => {
    expect(run(['intake'], [pending, { settled: true, count: 9 }])).toEqual([
      { view: 'all', latched: null, probing: false },
      { view: 'all', latched: null, probing: false },
    ]);
  });
});
