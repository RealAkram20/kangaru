import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiClient } from '../api/client';
import { login as loginRequest, logout as logoutRequest } from '../api/endpoints';
import { isApiError } from '../api/errors';
import type { User } from '../api/types';
import { API_BASE_URL } from '../config';
import { getCurrentToken, setCurrentToken } from './currentToken';
import { emitSessionExpired } from './sessionEvents';
import { clearSession, readSession, writeSession } from './tokenStore';

export type SignInOutcome =
  | { kind: 'signed_in' }
  | { kind: 'mfa_required' }
  | { kind: 'failed'; code: string; message: string };

type AuthValue = {
  /** Null until the stored session has been read — the splash gate. */
  ready: boolean;
  user: User | null;
  api: ApiClient;
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  /**
   * Drops the session without calling the server.
   *
   * For the one case where the token is already known to be dead: `PATCH
   * /auth/password` revokes every token including the caller's, so the
   * ordinary `signOut` would fire a request whose only possible answer is 401.
   */
  signOutLocally: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const handleUnauthenticated = useCallback(() => {
    setCurrentToken(null);
    setUser(null);
    void clearSession();
    emitSessionExpired();
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_BASE_URL,
        // Read at request time, so an in-flight call always uses the live
        // token rather than one captured at render.
        getToken: getCurrentToken,
        onUnauthenticated: handleUnauthenticated,
      }),
    [handleUnauthenticated],
  );

  useEffect(() => {
    void (async () => {
      const session = await readSession();

      if (session !== null) {
        setCurrentToken(session.token);
        setUser(session.user);
      }

      setReady(true);
    })();
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInOutcome> => {
      try {
        const result = await loginRequest(api, email, password);

        if (result.kind === 'mfa_required') {
          return { kind: 'mfa_required' };
        }

        setCurrentToken(result.token);
        await writeSession(result.token, result.user);
        setUser(result.user);

        return { kind: 'signed_in' };
      } catch (error) {
        if (isApiError(error)) {
          return { kind: 'failed', code: error.code, message: error.message };
        }

        return {
          kind: 'failed',
          code: 'OFFLINE',
          message: 'No connection. Signing in needs one — your saved work is safe.',
        };
      }
    },
    [api],
  );

  const signOut = useCallback(async () => {
    try {
      await logoutRequest(api);
    } catch {
      // The token is being discarded either way. A driver who cannot reach the
      // server must still be able to hand the phone over, and the token
      // expires within 24 hours regardless (ADR-0008).
    }

    setCurrentToken(null);
    setUser(null);
    await clearSession();
  }, [api]);

  const signOutLocally = useCallback(async () => {
    setCurrentToken(null);
    setUser(null);
    await clearSession();
  }, []);

  const value = useMemo(
    () => ({ ready, user, api, signIn, signOut, signOutLocally }),
    [ready, user, api, signIn, signOut, signOutLocally],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);

  if (value === null) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }

  return value;
}
