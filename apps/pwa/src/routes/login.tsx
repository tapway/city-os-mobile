import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@city-os/ui';
import { initFromCallbackFragment, getAccessToken, loginRedirect } from '../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (initFromCallbackFragment()) {
      navigate({ to: '/tickets' });
      return;
    }
    if (getAccessToken()) {
      navigate({ to: '/tickets' });
    }
  }, [navigate]);

  return (
    <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 320, padding: '32px 24px', textAlign: 'center' }}>
        <div className="hud-title" style={{ fontSize: 18, marginBottom: 8 }}>CITY HELP</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--ink-dim)', marginBottom: 24, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Field Operations App
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 24, lineHeight: 1.5 }}>
          Sign in to access your tickets, attendance, and field operations
        </p>
        <Button onClick={() => loginRedirect()} size="lg" className="w-full">
          Sign in with City Guard
        </Button>
      </div>
    </div>
  );
}