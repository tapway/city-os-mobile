import { describe, it, expect } from 'vitest';
import { actionButtons, missingRequirements } from '../src/lib/ticket-actions';

const [start] = actionButtons([{ action: 'start' }]);
const [evidence] = actionButtons([{ action: 'upload_evidence' }]);
const [support] = actionButtons([{ action: 'need_support' }]);

describe('missingRequirements — why an action button is disabled', () => {
  it('names nothing when every requirement is met', () => {
    expect(missingRequirements(start, { online: true, gpsFresh: true, photos: 0 })).toEqual([]);
  });

  it('names the stale GPS fix for a status change', () => {
    expect(missingRequirements(start, { online: false, gpsFresh: false, photos: 0 })).toEqual(['detail.req.gps']);
  });

  it('names the photo for evidence, but never GPS (evidence does not record a position)', () => {
    expect(missingRequirements(evidence, { online: true, gpsFresh: false, photos: 0 })).toEqual(['detail.req.photo']);
  });

  it('names the connection for need-support, which cannot queue offline', () => {
    expect(missingRequirements(support, { online: false, gpsFresh: false, photos: 0 })).toEqual(['detail.req.online']);
  });
});
