// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { EvidenceImage } from '../src/routes/evidence-image';
import { ApiError } from '../src/lib/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_A = '/api/storage/jira-attachments/2219/1/a.jpeg';
const URL_B = '/api/storage/jira-attachments/2219/2/b.jpeg';
const png = () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } });

let host: HTMLDivElement;
let root: Root;
let counter: number;
const revoke = vi.fn();
const create = vi.fn(() => `blob:${++counter}`);

function deps(fetcher: (p: string) => Promise<Response>) {
  return { fetcher, createObjectURL: create, revokeObjectURL: revoke, timeoutMs: 15_000 };
}
const mount = async (url: string, fetcher: (p: string) => Promise<Response>, settle = true) => {
  await act(async () => { root.render(createElement(EvidenceImage, { url, deps: deps(fetcher) })); });
  if (settle) await flush();
};
/** Let the download (including Blob reads, which take a macrotask) and the resulting render finish. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

beforeEach(() => {
  counter = 0;
  revoke.mockClear();
  create.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('EvidenceImage lifecycle (rendered)', () => {
  it('shows the fetched photo, and revokes its blob URL on unmount', async () => {
    await mount(URL_A, async () => png());
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:1');
    expect(revoke).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(revoke).toHaveBeenCalledWith('blob:1');
    root = createRoot(host); // so afterEach can unmount
  });

  it('a new url revokes the previous blob URL and loads the new photo', async () => {
    const fetcher = vi.fn(async () => png());
    await mount(URL_A, fetcher);
    await mount(URL_B, fetcher);
    expect(fetcher).toHaveBeenNthCalledWith(2, URL_B, expect.anything());
    expect(revoke).toHaveBeenCalledWith('blob:1');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:2');
  });

  it('a photo that arrives after unmount is revoked, not leaked', async () => {
    let release: (r: Response) => void = () => {};
    await mount(URL_A, () => new Promise<Response>((res) => { release = res; }));
    expect(host.querySelector('[data-testid="evidence-loading"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    release(png());
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });

  it('a transient failure shows a tap-to-retry button that recovers', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new ApiError(503, 'down'))
      .mockResolvedValueOnce(png());
    await mount(URL_A, fetcher);
    const btn = host.querySelector<HTMLButtonElement>('button[data-testid="evidence-unavailable"]');
    expect(btn?.textContent).toContain('Photo not available');
    expect(btn?.textContent).toContain('Tap to retry');
    await act(async () => { btn!.click(); });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:1');
  });

  it('retries by itself when the device comes back online', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new ApiError(0, 'offline'))
      .mockResolvedValueOnce(png());
    await mount(URL_A, fetcher);
    expect(host.querySelector('[data-testid="evidence-unavailable"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.querySelector('img')).not.toBeNull();
  });

  it('a 404 does not auto-retry on online, but a tap still retries', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new ApiError(404, 'gone'))
      .mockResolvedValueOnce(png());
    await mount(URL_A, fetcher);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[data-testid="evidence-unavailable"]')!.click(); });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.querySelector('img')).not.toBeNull();
  });

  it('does not stack retries: an online event while loading starts nothing new', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    await mount(URL_A, fetcher);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a hung request becomes the placeholder after 15 s', async () => {
    vi.useFakeTimers();
    try {
      await mount(URL_A, () => new Promise<Response>(() => {}), false);
      expect(host.querySelector('[data-testid="evidence-loading"]')).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(host.querySelector('[data-testid="evidence-unavailable"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
