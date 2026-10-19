import { LogOut } from 'lucide-react';
import { useLang } from '../i18n/react';
import { LanguageToggle } from '../i18n/LanguageToggle';

/**
 * Top bar: title, language switch, Sign out. Always one line (see .topbar in
 * styles.css): the title ellipsizes, and on narrow phones Sign out shrinks to
 * its icon while keeping its accessible name.
 */
export function AppHeader({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useLang();
  return (
    <header className="topbar">
      <span className="topbar-title">{t('app.header')}</span>
      {/* A field officer hands the handset over at the end of a shift; without
          this the session (and the cached screens) stayed on the device. */}
      <LanguageToggle />
      <button type="button" className="topbar-btn topbar-signout" aria-label={t('app.signOut')} onClick={onSignOut}>
        <LogOut size={16} aria-hidden="true" />
        <span className="signout-label">{t('app.signOut')}</span>
      </button>
    </header>
  );
}
