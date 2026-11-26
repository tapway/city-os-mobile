/**
 * The bell: the signed-in user's in-app notifications.
 *
 * City Help addresses a notification to a user, a role or a department; role and
 * department rows are a shared inbox, so "read" can mean a colleague read it.
 */
import { apiJson } from './api';
import type { Lang } from '../i18n';

export interface NotificationItem {
  id: number;
  kind: string;
  ticket_uid: string | null;
  title_en: string | null;
  title_bm: string | null;
  body_en: string | null;
  body_bm: string | null;
  created_at: string | null;
  read_at: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  unread_count: number;
}

export function listNotifications(opts: { unread?: boolean; limit?: number } = {}): Promise<NotificationPage> {
  const q = new URLSearchParams();
  if (opts.unread) q.set('unread', 'true');
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return apiJson<NotificationPage>(`/api/v1/notifications${qs ? `?${qs}` : ''}`);
}

export function markRead(id: number): Promise<NotificationItem> {
  return apiJson<NotificationItem>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
}

export function markAllRead(): Promise<{ updated: number }> {
  return apiJson<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST' });
}

/** Active-language text, falling back to the other language before anything empty. */
export function notificationText(n: NotificationItem, lang: Lang): { title: string; body: string } {
  const [title, body] = lang === 'ms'
    ? [n.title_bm || n.title_en, n.body_bm || n.body_en]
    : [n.title_en || n.title_bm, n.body_en || n.body_bm];
  return { title: title || '', body: body || '' };
}