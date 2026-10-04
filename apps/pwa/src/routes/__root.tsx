import { Outlet, Link, useLocation } from '@tanstack/react-router';
import { List, Clock, Plus, LogOut } from 'lucide-react';
import { logout, getSessionUser } from '../lib/auth';
import { canCreateTickets } from '../lib/permissions';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { authNotice, syncNotice, otherUserNotice, logoutWarning } from '../lib/offline-queue';
import { useLang } from '../i18n/react';
import { LanguageToggle } from '../i18n/LanguageToggle';

const NAV_ITEM_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  padding: '4px 0',
  textDecoration: 'none',
};

const NAV_LABEL_STYLE = {
  fontFamily: 'var(--font-label)',
  fontSize: '9px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
};

export function RootLayout() {
  const { t, tm } = useLang();
  const location = useLocation();
  const online = useOnlineStatus();
  const { pending, syncing, lastResult, flush } = useOfflineSync();
  const droppedNotice = syncNotice(lastResult);
  const signInNotice = authNotice(lastResult);
  const heldNotice = otherUserNotice(lastResult);
  const showCreate = canCreateTickets(getSessionUser()?.roles);

  const signOut = () => {
    // Pending updates stay on the device, held until their author signs in again.
    const warning = logoutWarning(pending);
    if (warning && !window.confirm(tm(warning))) return;
    void logout();
  };
  const isLogin = location.pathname === '/login';
  const isActive = (path: string) =>
    path === '/tickets'
      ? location.pathname === '/' || location.pathname.startsWith('/tickets')
      : location.pathname.startsWith(path);

  return (
    <div className="app-shell" style={{ background: 'var(--bg-deep)' }}>
      {!isLogin && (
        <header
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: '10px 16px', background: 'var(--glass)',
            borderBottom: '1px solid var(--border)', backdropFilter: 'blur(24px)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-label)', fontSize: 10, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--ink-dim)',
            }}
          >
            {t('app.header')}
          </span>
          {/* A field officer hands the handset over at the end of a shift; without
              this the session (and the cached screens) stayed on the device. */}
          <LanguageToggle />
          <button
            type="button"
            onClick={signOut}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 2, color: 'var(--ink-dim)', cursor: 'pointer',
              fontFamily: 'var(--font-label)', fontSize: 10,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            {t('app.signOut')}
          </button>
        </header>
      )}
      <main className="app-content">
        {!isLogin && signInNotice && (
          <div
            role="alert"
            style={{
              padding: '8px 16px', background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid var(--border)',
              fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'center',
            }}
          >
            <span style={{ flex: 1 }}>{tm(signInNotice)}</span>
            <Link to="/login" style={{ color: 'var(--cyan)', fontFamily: 'var(--font-label)', textTransform: 'uppercase' }}>
              {t('offline.signInLink')}
            </Link>
          </div>
        )}
        {!isLogin && heldNotice && (
          <div
            role="status"
            style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--ink-dim)' }}
          >
            {tm(heldNotice)}
          </div>
        )}
        {!isLogin && droppedNotice && (
          <div
            role="alert"
            style={{
              padding: '8px 16px', background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid var(--border)',
              fontSize: 12, color: 'var(--danger)',
            }}
          >
            {tm(droppedNotice)}
          </div>
        )}
        {!isLogin && (!online || pending > 0) && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: '8px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              background: online ? 'rgba(61,232,255,0.08)' : 'rgba(239,68,68,0.12)',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-label)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: online ? 'var(--cyan)' : 'var(--danger)',
            }}
          >
            <span>
              {online
                ? syncing
                  ? t('offline.syncing', { pending })
                  : t('offline.waiting', { pending })
                : t('offline.banner')}
            </span>
            {online && pending > 0 && (
              <button
                type="button"
                data-testid="queue-send-now"
                onClick={() => void flush()}
                disabled={syncing}
                style={{
                  padding: '4px 10px', background: 'transparent', border: '1px solid var(--cyan)',
                  borderRadius: 2, color: 'var(--cyan)', cursor: 'pointer', fontFamily: 'var(--font-label)',
                  fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >
                {t('offline.sendNow')}
              </button>
            )}
          </div>
        )}
        <Outlet />
      </main>
      {!isLogin && (
        <nav
          className="app-bottom-nav flex justify-around items-center px-4 py-2"
          aria-label={t('nav.aria')}
          style={{ background: 'var(--glass)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(24px)' }}
        >
          <Link
            to="/tickets"
            style={{ ...NAV_ITEM_STYLE, color: isActive('/tickets') ? 'var(--cyan)' : 'var(--ink-dim)' }}
            aria-current={isActive('/tickets') ? 'page' : undefined}
          >
            <List size={22} aria-hidden="true" />
            <span style={NAV_LABEL_STYLE}>{t('nav.tickets')}</span>
          </Link>
          {showCreate && (
            <Link
              to="/create-ticket"
              aria-label={t('nav.report')}
              aria-current={isActive('/create-ticket') ? 'page' : undefined}
              className="flex flex-col items-center -mt-3"
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'var(--cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 20px var(--cyan-glow)',
                }}
              >
                <Plus size={24} style={{ color: 'var(--bg-deep)' }} aria-hidden="true" />
              </div>
            </Link>
          )}
          <Link
            to="/attendance"
            style={{ ...NAV_ITEM_STYLE, color: isActive('/attendance') ? 'var(--cyan)' : 'var(--ink-dim)' }}
            aria-current={isActive('/attendance') ? 'page' : undefined}
          >
            <Clock size={22} aria-hidden="true" />
            <span style={NAV_LABEL_STYLE}>{t('nav.attendance')}</span>
          </Link>
        </nav>
      )}
    </div>
  );
}