/**
 * Password sign-in (auth mode "password").
 *
 * The BFF does the OAuth password grant, so the browser never leaves the app
 * and never has to resolve Keycloak's hostname. This module is framework-free
 * so the rules (messages, busy guard) are unit-testable without a DOM.
 *
 * The password is only ever passed to fetch(): it is not stored, logged, or
 * kept in controller state.
 */
import { setAccessToken } from './auth';

export type AuthMode = 'password' | 'pkce';

/** Plain English for now; M4 adds BM and can key off these status codes. */
export const LOGIN_ERRORS = {
  401: 'Incorrect username or password. Check them and try again.',
  403: 'This account is not fully set up yet. Ask an administrator to finish setting it up in Keycloak.',
  422: 'Enter both your username and your password.',
  429: 'Too many sign-in attempts. Wait a minute, then try again.',
  503: 'Sign-in is unavailable right now. Check your connection and try again shortly.',
} as const;

const GENERIC_ERROR = 'Sign-in failed. Please try again.';

export async function fetchAuthMode(): Promise<AuthMode> {
  try {
    const resp = await fetch('/auth/config');
    if (resp.ok) {
      const data = (await resp.json()) as { mode?: string };
      if (data.mode === 'pkce' || data.mode === 'password') return data.mode;
    }
  } catch {
    // fall through to the default
  }
  return 'password';
}

export type LoginResult = { ok: true } | { ok: false; message: string };

export async function submitPasswordLogin(username: string, password: string): Promise<LoginResult> {
  let resp: Response;
  try {
    resp = await fetch('/auth/password-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return { ok: false, message: LOGIN_ERRORS[503] };
  }

  if (resp.ok) {
    try {
      const data = (await resp.json()) as { access_token?: string; expires_in?: number };
      if (data.access_token) {
        setAccessToken(data.access_token, data.expires_in ?? 300);
        return { ok: true };
      }
    } catch {
      // fall through
    }
    return { ok: false, message: GENERIC_ERROR };
  }

  const known = LOGIN_ERRORS[resp.status as keyof typeof LOGIN_ERRORS];
  if (known) return { ok: false, message: known };
  return { ok: false, message: resp.status >= 500 ? LOGIN_ERRORS[503] : GENERIC_ERROR };
}

export interface LoginState {
  busy: boolean;
  error: string | null;
}

interface ControllerDeps {
  submit: (username: string, password: string) => Promise<LoginResult>;
  onSuccess: () => void;
}

/** Holds busy/error state and refuses a second submit while one is in flight. */
export function createPasswordLoginController({ submit, onSuccess }: ControllerDeps) {
  let state: LoginState = { busy: false, error: null };
  const listeners = new Set<() => void>();
  const set = (next: LoginState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async submit(username: string, password: string): Promise<void> {
      if (state.busy) return;
      if (!username.trim() || !password.trim()) {
        set({ busy: false, error: LOGIN_ERRORS[422] });
        return;
      }
      set({ busy: true, error: null });
      let result: LoginResult;
      try {
        result = await submit(username.trim(), password);
      } catch {
        result = { ok: false, message: GENERIC_ERROR };
      }
      if (result.ok) {
        set({ busy: false, error: null });
        onSuccess();
      } else {
        set({ busy: false, error: result.message });
      }
    },
  };
}
