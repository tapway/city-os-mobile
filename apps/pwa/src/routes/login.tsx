import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@city-os/ui';
import { bootstrapSession, loginRedirect } from '../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { returnTo?: string };
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    // A valid refresh cookie means the user is already signed in — go straight
    // to where they were headed rather than showing the button again.
    bootstrapSession().then((ok) => {
      if (!active) return;
      if (ok) {
        navigate({ to: (search.returnTo as never) || '/tickets' });
        return;
      }
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [navigate, search.returnTo]);

  return (
    <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 320, padding: '32px 24px', textAlign: 'center' }}>
        <h1 className="hud-title" style={{ fontSize: 18, marginBottom: 8 }}>CITY HELP</h1>
        <div
          style={{
            fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--ink-dim)',
            marginBottom: 24, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}
        >
          Field Operations App
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 24, lineHeight: 1.5 }}>
          Sign in to search tickets, add comments and photos, and record your GPS position on site.
        </p>
        <Button
          onClick={() => loginRedirect()}
          size="lg"
          className="w-full"
          disabled={checking}
          style={{ width: '100%' }}
        >
          {checking ? 'Checking session…' : 'Sign in with City Guard'}
        </Button>
      </div>
    </div>
  );
}