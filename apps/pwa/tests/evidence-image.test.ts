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
  it('fetches the object with the signed-in client and returns an object URL', async () => {
    const fetcher = vi.fn(async () => imageResponse());
    const createObjectURL = vi.fn(() => 'blob:abc');
    const url = await loadEvidenceImage(JIRA_URL, { fetcher, createObjectURL });
    expect(fetcher).toHaveBeenCalledWith(JIRA_URL);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(url).toBe('blob:abc');
  });

  it('is null (not an exception) when the server refuses or the object is gone', async () => {
    for (const status of [401, 403, 404, 503]) {
      const fetcher = vi.fn(async () => {
        throw new ApiError(status, 'nope');
      });
      const createObjectURL = vi.fn(() => 'blob:abc');
      expect(await loadEvidenceImage(JIRA_URL, { fetcher, createObjectURL }), String(status)).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
    }
  });

  it('is null when the device is offline', async () => {
    const fetcher = vi.fn(async () => {
      throw new ApiError(0, 'offline');
    });
    expect(await loadEvidenceImage(JIRA_URL, { fetcher, createObjectURL: () => 'blob:x' })).toBeNull();
  });

  it('is null when the answer is not an image (an error page must not become a picture)', async () => {
    const fetcher = vi.fn(async () => imageResponse('text/html'));
    const createObjectURL = vi.fn(() => 'blob:abc');
    expect(await loadEvidenceImage(JIRA_URL, { fetcher, createObjectURL })).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('EvidenceThumbView', () => {
  const t = (key: keyof typeof en) => en[key];
  const view = (state: Parameters<typeof EvidenceThumbView>[0]['state']) =>
    renderToStaticMarkup(createElement(EvidenceThumbView, { state, alt: en['detail.evidenceAlt'], unavailable: en['detail.photoUnavailable'] }));

  it('ready: a linked image carrying the alt text', () => {
    const html = view({ status: 'ready', src: 'blob:abc' });
    expect(html).toContain('<img');
    expect(html).toContain('src="blob:abc"');
    expect(html).toContain('href="blob:abc"');
    expect(html).toContain(`alt="${t('detail.evidenceAlt')}"`);
  });

  it('unavailable: a labelled placeholder, no <img> and no dead link', () => {
    const html = view({ status: 'unavailable' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a ');
    expect(html).toContain('Photo not available');
    expect(html).toContain('data-testid="evidence-unavailable"');
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
