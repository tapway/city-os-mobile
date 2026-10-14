import { useEffect, useMemo, useRef, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@city-os/ui';
import {
  createPasswordLoginController,
  submitPasswordLogin,
  type LoginState,
} from '../lib/password-login';
import { useLang } from '../i18n/react';

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  fontSize: 16, // >=16px stops iOS zooming the page on focus
  background: 'rgba(0,0,0,0.25)',
  color: 'var(--ink, inherit)',
  border: '1px solid var(--line, rgba(255,255,255,0.25))',
  borderRadius: 4,
} as const;

const labelStyle = { display: 'block', fontSize: 11, textAlign: 'left', marginBottom: 4 } as const;

/** Presentational: the markup for the form, driven entirely by props. */
export function PasswordLoginFields({
  busy,
  error,
  onSubmit,
}: LoginState & { onSubmit: (username: string, password: string) => void }) {
  const { t } = useLang();
  const handle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit(String(data.get('username') ?? ''), String(data.get('password') ?? ''));
  };

  return (
    <form onSubmit={handle} aria-busy={busy} noValidate style={{ textAlign: 'left' }}>
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="login-username" className="hud-label" style={labelStyle}>
          {t('login.username')}
        </label>
        <input
          id="login-username"
          name="username"
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={busy}
          style={fieldStyle}
        />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="login-password" className="hud-label" style={labelStyle}>
          {t('login.password')}
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          required
          disabled={busy}
          style={fieldStyle}
        />
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--red, #ff6b6b)', fontSize: 12, lineHeight: 1.4, margin: '0 0 14px' }}>
          {t(error)}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy} style={{ width: '100%' }}>
        {busy ? t('login.submitting') : t('login.submit')}
      </Button>
    </form>
  );
}

/** Wires the form to /auth/password-login. `onSuccess` runs the post-sign-in routing. */
export function PasswordLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });
  const controller = useMemo(
    () =>
      createPasswordLoginController({
        submit: submitPasswordLogin,
        onSuccess: () => onSuccessRef.current(),
      }),
    [],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return <PasswordLoginFields {...state} onSubmit={(u, p) => void controller.submit(u, p)} />;
}
