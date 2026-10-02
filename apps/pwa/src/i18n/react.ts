import { useCallback, useSyncExternalStore } from 'react';
import { getLang, setLang, subscribe, t, type Lang } from './index';

/** Subscribes the component to language changes; returns the active language, `t` and a setter. */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, getLang, () => 'en' as Lang);
  const set = useCallback((l: Lang) => setLang(l), []);
  return { lang, t, setLang: set };
}
