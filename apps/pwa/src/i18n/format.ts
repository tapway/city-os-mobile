import { getLang, type Lang } from './index';

export const localeFor = (lang: Lang): string => (lang === 'ms' ? 'ms-MY' : 'en-MY');

/** "05 Okt, 09:30"-style short date/time in the app language; '' for empty/invalid input. */
export function formatDateTime(value: string | null, lang: Lang = getLang()): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(localeFor(lang), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(value: string | null, lang: Lang = getLang()): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(localeFor(lang));
}
