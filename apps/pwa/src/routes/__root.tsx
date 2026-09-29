import { Outlet, Link, useLocation } from '@tanstack/react-router';
import { List, Clock, Plus } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOfflineSync } from '../hooks/useOfflineSync';

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
  const location = useLocation();
  const online = useOnlineStatus();
  const { pending, syncing } = useOfflineSync();
  const isLogin = location.pathname === '/login';
  const isActive = (path: string) =>
    path === '/tickets'
      ? location.pathname === '/' || location.pathname.startsWith('/tickets')
      : location.pathname.startsWith(path);

  return (
    <div className="app-shell" style={{ background: 'var(--bg-deep)' }}>
      <main className="app-content">
        {!isLogin && (!online || pending > 0) && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: '8px 16px',
              background: online ? 'rgba(61,232,255,0.08)' : 'rgba(239,68,68,0.12)',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-label)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: online ? 'var(--cyan)' : 'var(--danger)',
            }}
          >
            {online
              ? syncing
                ? `Syncing ${pending} queued update(s)…`
                : `${pending} update(s) waiting to sync`
              : 'Offline — updates will sync when you reconnect'}
          </div>
        )}
        <Outlet />
      </main>
      {!isLogin && (
        <nav
          className="app-bottom-nav flex justify-around items-center px-4 py-2"
          aria-label="Main navigation"
          style={{ background: 'var(--glass)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(24px)' }}
        >
          <Link
            to="/tickets"
            style={{ ...NAV_ITEM_STYLE, color: isActive('/tickets') ? 'var(--cyan)' : 'var(--ink-dim)' }}
            aria-current={isActive('/tickets') ? 'page' : undefined}
          >
            <List size={22} aria-hidden="true" />
            <span style={NAV_LABEL_STYLE}>Tickets</span>
          </Link>
          <Link
            to="/create-ticket"
            aria-label="Report an incident"
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
          <Link
            to="/attendance"
            style={{ ...NAV_ITEM_STYLE, color: isActive('/attendance') ? 'var(--cyan)' : 'var(--ink-dim)' }}
            aria-current={isActive('/attendance') ? 'page' : undefined}
          >
            <Clock size={22} aria-hidden="true" />
            <span style={NAV_LABEL_STYLE}>Attendance</span>
          </Link>
        </nav>
      )}
    </div>
  );
}