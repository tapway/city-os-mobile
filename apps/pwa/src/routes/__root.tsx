import { Outlet, Link, useLocation } from '@tanstack/react-router';
import { List, Clock, Plus } from 'lucide-react';

export function RootLayout() {
  const location = useLocation();
  const isLogin = location.pathname === '/login';
  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <div className="app-shell" style={{ background: 'var(--bg-deep)' }}>
      <main className="app-content">
        <Outlet />
      </main>
      {!isLogin && (
        <nav className="app-bottom-nav flex justify-around items-center px-4 py-2"
          style={{ background: 'var(--glass)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(24px)' }}>
          <Link
            to="/tickets"
            className="flex flex-col items-center py-1 text-xs"
            style={{ color: isActive('/tickets') || isActive('/') ? 'var(--cyan)' : 'var(--ink-dim)' }}
          >
            <List size={22} />
            <span style={{ fontFamily: 'var(--font-label)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tickets</span>
          </Link>
          <Link
            to="/create-ticket"
            className="flex flex-col items-center -mt-3"
          >
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px var(--cyan-glow)',
            }}>
              <Plus size={24} style={{ color: 'var(--bg-deep)' }} />
            </div>
          </Link>
          <Link
            to="/attendance"
            className="flex flex-col items-center py-1 text-xs"
            style={{ color: isActive('/attendance') ? 'var(--cyan)' : 'var(--ink-dim)' }}
          >
            <Clock size={22} />
            <span style={{ fontFamily: 'var(--font-label)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Attendance</span>
          </Link>
        </nav>
      )}
    </div>
  );
}