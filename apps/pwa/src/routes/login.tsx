import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@city-os/ui';
import { bootstrapSession, loginRedirect, markSignedIn } from '../lib/auth';
import { fetchAuthMode, type AuthMode } from '../lib/password-login';
import { PasswordLoginForm } from './password-login-form';

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { returnTo?: string };
  const [mode, setMode] = useState<AuthMode | null>(null);

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
      // Only now is it worth asking which sign-in to offer.
      fetchAuthMode().then((m) => {
        if (active) setMode(m);
      });
    });
    return () => {
      active = false;
    };
  }, [navigate, search.returnTo]);

  // Same routing as a returning session: bootstrapSession() reads the identity
  // the BFF just stored, then we go where the user was headed.
  const afterPasswordLogin = () => {
    // requireAuth cached "signed out" before the form was submitted; replace it
    // or the guard bounces straight back here.
    markSignedIn(true);
    void bootstrapSession().then(() => navigate({ to: (search.returnTo as never) || '/tickets' }));
  };

  return <LoginBody mode={mode} onPkce={loginRedirect} onPasswordSuccess={afterPasswordLogin} />;
}

export function LoginBody({
  mode,
  onPkce,
  onPasswordSuccess,
}: {
  /** null while the session / config check is still running. */
  mode: AuthMode | null;
  onPkce: () => void;
  onPasswordSuccess: () => void;
}) {
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
        {mode === 'password' ? (
          <PasswordLoginForm onSuccess={onPasswordSuccess} />
        ) : (
          <Button onClick={onPkce} size="lg" className="w-full" disabled={mode === null} style={{ width: '100%' }}>
            {mode === null ? 'Checking session…' : 'Sign in with City Guard'}
          </Button>
        )}
      </div>
    </div>
  );
}