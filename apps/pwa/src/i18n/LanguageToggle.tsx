import { useLang } from './react';
import type { Lang } from './index';

/** Compact EN | BM switch; the active language is aria-pressed. */
export function LanguageToggle() {
  const { lang, t, setLang } = useLang();
  const btn = (l: Lang) => {
    const active = lang === l;
    return (
      <button
        key={l}
        type="button"
        lang={l}
        aria-pressed={active}
        aria-label={t(l === 'en' ? 'lang.switchToEn' : 'lang.switchToMs')}
        onClick={() => setLang(l)}
        style={{
          padding: '5px 8px', fontSize: 10, fontFamily: 'var(--font-label)', letterSpacing: '0.08em',
          cursor: 'pointer', background: active ? 'rgba(61,232,255,0.12)' : 'transparent',
          color: active ? 'var(--cyan)' : 'var(--ink-dim)',
          border: `1px solid ${active ? 'var(--cyan)' : 'var(--border)'}`,
          borderRadius: 2,
        }}
      >
        {t(l === 'en' ? 'lang.en' : 'lang.ms')}
      </button>
    );
  };
  return (
    <div role="group" aria-label={t('lang.label')} style={{ display: 'inline-flex', gap: 4 }}>
      {btn('en')}
      {btn('ms')}
    </div>
  );
}
