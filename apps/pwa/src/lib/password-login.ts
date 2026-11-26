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
import type { MessageKey } from '../i18n';

export type AuthMode = 'password' | 'pkce';

/** Sign-in error message keys by HTTP status; rendered with t() at display time (EN/BM). */
export const LOGIN_ERROR_KEYS = {
  401: 'login.error.401',
  403: 'login.error.403',
  422: 'login.error.422',
  429: 'login.error.429',
  503: 'login.error.503',
} as const satisfies Record<number, MessageKey>;

export function loginErrorKey(status: number): MessageKey {
  const known = LOGIN_ERROR_KEYS[status as keyof typeof LOGIN_ERROR_KEYS];
  if (known) return known;
  return status >= 500 ? LOGIN_ERROR_KEYS[503] : 'login.error.generic';
}

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

export type LoginResult = { ok: true } | { ok: false; messageKey: MessageKey };

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
    return { ok: false, messageKey: LOGIN_ERROR_KEYS[503] };
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
    return { ok: false, messageKey: 'login.error.generic' };
  }

  return { ok: false, messageKey: loginErrorKey(resp.status) };
}

export interface LoginState {
  busy: boolean;
  error: MessageKey | null;
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
        set({ busy: false, error: LOGIN_ERROR_KEYS[422] });
        return;
      }
      set({ busy: true, error: null });
      let result: LoginResult;
      try {
        result = await submit(username.trim(), password);
      } catch {
        result = { ok: false, messageKey: 'login.error.generic' };
      }
      if (result.ok) {
        set({ busy: false, error: null });
        onSuccess();
      } else {
        set({ busy: false, error: result.messageKey });
      }
    },
  };
}
