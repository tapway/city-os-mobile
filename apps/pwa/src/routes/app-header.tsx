import { LogOut, Bell } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useLang } from '../i18n/react';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { useUnreadAlerts } from '../hooks/useUnreadAlerts';

/**
 * Top bar: title, language switch, Sign out. Always one line (see .topbar in
 * styles.css): the title ellipsizes, and on narrow phones Sign out shrinks to
 * its icon while keeping its accessible name.
 */
export function AppHeader({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useLang();
  const { unread } = useUnreadAlerts();
  return (
    <header className="topbar">
      <span className="topbar-title">{t('app.header')}</span>
      <Link
        to="/notifications"
        data-testid="alerts-bell"
        aria-label={unread > 0 ? `${t('nav.notifications')} — ${t('alerts.unreadCount', { n: unread })}` : t('nav.notifications')}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', color: unread > 0 ? 'var(--cyan)' : 'var(--ink-dim)', textDecoration: 'none', padding: '0 2px' }}
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && (
          <span
            data-testid="alerts-bell-count"
            aria-hidden="true"
            style={{
              position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16, borderRadius: 8,
              background: 'var(--cyan)', color: 'var(--bg-deep)', fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
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
