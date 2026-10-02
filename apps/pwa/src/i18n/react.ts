import { useCallback, useSyncExternalStore } from 'react';
import { getLang, setLang, subscribe, t, translateMsg, type Lang, type Msg } from './index';

/** Subscribes the component to language changes; returns the active language, `t` and a setter. */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, getLang, () => 'en' as Lang);
  const set = useCallback((l: Lang) => setLang(l), []);
  const tm = useCallback((m: Msg) => translateMsg(lang, m), [lang]);
  return { lang, t, tm, setLang: set };
}
