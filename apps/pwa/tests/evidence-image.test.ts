import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evidenceSource, loadEvidenceImage } from '../src/lib/evidence-image';
import { EvidenceThumbView } from '../src/routes/evidence-image';
import { ApiError } from '../src/lib/api';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';

const here = dirname(fileURLToPath(import.meta.url));
const JIRA_URL = '/api/storage/jira-attachments/2219/27750/WhatsApp_Image.jpeg';

const imageResponse = (type = 'image/jpeg') => new Response(new Blob(['x'], { type }), { status: 200 });

describe('evidenceSource: which images need the signed-in fetch', () => {
  it('City Help storage objects (Jira imports) are behind the bearer token', () => {
    expect(evidenceSource(JIRA_URL)).toBe('authenticated');
    expect(evidenceSource('/api/storage/mobile-attachments/T-1/a.png')).toBe('authenticated');
  });

  it('BFF uploads, absolute and data URLs load straight into <img>', () => {
    expect(evidenceSource('/api/uploads/mobile-attachments/T-1/a.png')).toBe('direct');
    expect(evidenceSource('https://cdn.example.com/a.png')).toBe('direct');
    expect(evidenceSource('data:image/png;base64,AAAA')).toBe('direct');
  });
});

describe('loadEvidenceImage', () => {
  const mkDeps = (fetcher: (path: string, signal?: AbortSignal) => Promise<Response>, createObjectURL = vi.fn(() => 'blob:abc')) => ({
    fetcher, createObjectURL, revokeObjectURL: vi.fn(),
  });

  it('fetches the object with the signed-in client and returns an object URL', async () => {
    const fetcher = vi.fn(async () => imageResponse());
    const deps = mkDeps(fetcher);
    const r = await loadEvidenceImage(JIRA_URL, deps);
    expect(fetcher).toHaveBeenCalledWith(JIRA_URL, expect.any(AbortSignal));
    expect(deps.createObjectURL).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ status: 'ready', src: 'blob:abc' });
  });

  it('403 and 404 are "not available" and not worth retrying automatically', async () => {
    for (const status of [403, 404]) {
      const deps = mkDeps(async () => { throw new ApiError(status, 'nope'); });
      expect(await loadEvidenceImage(JIRA_URL, deps), String(status)).toEqual({ status: 'unavailable', retryable: false });
      expect(deps.createObjectURL).not.toHaveBeenCalled();
    }
  });

  it('401, 5xx and offline are transient: retryable', async () => {
    for (const status of [401, 500, 503, 0]) {
      const deps = mkDeps(async () => { throw new ApiError(status, 'nope'); });
      expect(await loadEvidenceImage(JIRA_URL, deps), String(status)).toEqual({ status: 'unavailable', retryable: true });
    }
  });

  it('a request that hangs turns into a retryable failure after 15 s', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const deps = mkDeps((_p, signal) => new Promise<Response>(() => { signal?.addEventListener('abort', () => { aborted = true; }); }));
      const pending = loadEvidenceImage(JIRA_URL, deps);
      await vi.advanceTimersByTimeAsync(14_999);
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ status: 'unavailable', retryable: true });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an answer that is not an image is unavailable (an error page must not become a picture)', async () => {
    const deps = mkDeps(async () => imageResponse('text/html'));
    expect(await loadEvidenceImage(JIRA_URL, deps)).toEqual({ status: 'unavailable', retryable: false });
    expect(deps.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('EvidenceThumbView', () => {
  const t = (key: keyof typeof en) => en[key];
  const view = (state: Parameters<typeof EvidenceThumbView>[0]['state']) =>
    renderToStaticMarkup(createElement(EvidenceThumbView, { state, alt: en['detail.evidenceAlt'], unavailable: en['detail.photoUnavailable'], retry: en['detail.photoRetry'], onRetry: () => {} }));

  it('ready: a linked image carrying the alt text', () => {
    const html = view({ status: 'ready', src: 'blob:abc' });
    expect(html).toContain('<img');
    expect(html).toContain('src="blob:abc"');
    expect(html).toContain('href="blob:abc"');
    expect(html).toContain(`alt="${t('detail.evidenceAlt')}"`);
  });

  it('unavailable: a labelled placeholder, no <img> and no dead link', () => {
    const html = view({ status: 'unavailable', retryable: true });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a ');
    expect(html).toContain('Photo not available');
    expect(html).toContain('data-testid="evidence-unavailable"');
    // tap to retry, as a real button
    expect(html).toMatch(/<button type="button"[^>]*data-testid="evidence-unavailable"/);
    expect(html).toContain('Tap to retry');
  });

  it('loading: no broken image while the photo downloads', () => {
    const html = view({ status: 'loading' });
    expect(html).not.toContain('<img');
    expect(html).toContain('aria-busy="true"');
  });
});

describe('photo-unavailable text', () => {
  it('exists in English and Bahasa Melayu', () => {
    expect(en['detail.photoUnavailable']).toBe('Photo not available');
    expect(ms['detail.photoUnavailable']).toBeTruthy();
    expect(ms['detail.photoUnavailable']).not.toBe(en['detail.photoUnavailable']);
    expect(en['detail.photoRetry']).toBe('Tap to retry');
    expect(ms['detail.photoRetry']).toBeTruthy();
    expect(ms['detail.photoRetry']).not.toBe(en['detail.photoRetry']);
  });
});

describe('ticket detail', () => {
  const detail = readFileSync(resolve(here, '../src/routes/ticket.$id.tsx'), 'utf8');

  it('shows stored evidence through EvidenceImage, never a bare <img src> that cannot send the bearer token', () => {
    expect(detail).toMatch(/<EvidenceImage\b/);
    expect(detail).not.toMatch(/<img[^>]*src=\{storageUrl/);
    expect(detail).not.toMatch(/href=\{storageUrl/);
  });
});
