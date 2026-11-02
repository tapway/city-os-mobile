/**
 * Turn a Web Push payload into a notification, and a click into an in-app path.
 *
 * Pure so the service worker's decision can be unit-tested: a service worker has
 * no DOM and cannot be exercised by the app's normal tests.
 */
import type { Lang } from '../i18n';

export interface PushPayload {
  title?: string;
  body?: string;
  title_bm?: string;
  body_bm?: string;
  url?: string;
  tag?: string;
  kind?: string;
}

export interface ShownNotification {
  title: string;
  body: string;
  tag?: string;
  data: { url: string };
}

/**
 * Only an app-relative ticket path may become a click target.
 *
 * The payload crosses a push service; treating it as trusted would let a forged
 * or buggy sender navigate the officer to an arbitrary site (including
 * `javascript:`), so anything unexpected falls back to the ticket list.
 */
export function safeTicketPath(url?: string): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/tickets';
  if (!/^\/(tickets?)(\/|$)/.test(url)) return '/tickets';
  return url;
}

export function pushToNotification(p: PushPayload, lang: Lang): ShownNotification {
  const [title, body] = lang === 'ms'
    ? [p.title_bm || p.title, p.body_bm || p.body]
    : [p.title || p.title_bm, p.body || p.body_bm];
  return {
    title: title || 'City Help',
    body: body || '',
    ...(p.tag ? { tag: p.tag } : {}),
    data: { url: safeTicketPath(p.url) },
  };
}