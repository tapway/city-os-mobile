import { Outlet, Link, useLocation } from '@tanstack/react-router';
import { List, Clock } from 'lucide-react';

export function RootLayout() {
  const location = useLocation();
  const isLogin = location.pathname === '/login';
  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </main>
      {!isLogin && (
        <nav className="app-bottom-nav flex justify-around border-t border-gray-200 bg-white">
          <Link
            to="/tickets"
            className={`flex flex-col items-center py-2 text-xs ${isActive('/tickets') || isActive('/') ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <List size={24} />
            <span>Tickets</span>
          </Link>
          <Link
            to="/attendance"
            className={`flex flex-col items-center py-2 text-xs ${isActive('/attendance') ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Clock size={24} />
            <span>Attendance</span>
          </Link>
        </nav>
      )}
    </div>
  );
}