import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiClient } from '../api/client';
import {
  login as loginRequest,
  logout as logoutRequest,
  unregisterDevice,
} from '../api/endpoints';
import { goOffline } from '../duty/OnlineService';
import { forgetPushToken, readPushToken } from '../push/tokenStore';
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
  /**
   * Accepts a session minted somewhere other than the password form —
   * today, `/auth/social` (ADR-0028 §3). The token is the same
   * driver-scoped kind `signIn` stores; only the door differs.
   */
  adoptSession: (user: User, token: string) => Promise<void>;
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

/**
 * Stops job offers reaching this handset.
 *
 * Best-effort, like everything else about push. A driver signing off in a
 * basement must still be able to sign off — the server's own revocation
 * paths drop device rows too (ADR-0016 §5), and Expo prunes a token whose
 * app is gone. Blocking a sign-out on this would be trading a certainty for
 * a nicety.
 */
async function releasePushRegistration(api: ApiClient): Promise<void> {
  try {
    const token = await readPushToken();

    if (token !== null) {
      await unregisterDevice(api, token);
    }
  } catch {
    // See above.
  } finally {
    await forgetPushToken();
  }
}

/**
 * How long to wait for the keystore before giving up on it.
 *
 * Reading two small values out of Keychain/Keystore is a few milliseconds on
 * any working device, so a wait this long already means something is wrong.
 */
const SESSION_RESTORE_TIMEOUT_MS = 3_000;

/**
 * Resolves to null rather than waiting forever.
 *
 * A `try/catch/finally` around the restore was the first fix and it was not
 * enough: it handles a promise that *rejects*, and the failure here is a
 * promise that never settles at all. `SecureStore.getItemAsync` can hang —
 * an unavailable native module, a keystore the OS will not open — and a
 * `finally` never runs for a pending promise. The app sat on its spinner
 * exactly as before.
 *
 * A race is the honest shape for "this must not be able to block startup".
 * The losing promise is left to settle whenever it likes; nothing is
 * listening.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

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
      try {
        const session = await withTimeout(readSession(), SESSION_RESTORE_TIMEOUT_MS);

        if (session !== null) {
          setCurrentToken(session.token);
          setUser(session.user);
        }
      } catch {
        // Signed out, not stuck.
        //
        // `readSession` guards its own JSON parse but not the keystore
        // itself, and `SecureStore.getItemAsync` can reject — a device with
        // no lock screen, a keystore the OS has invalidated, an Expo Go
        // build without the native module. Without this catch the rejection
        // escaped, `setReady(true)` never ran, and the app sat on its
        // loading spinner forever with nothing to tell the driver.
        //
        // `readSession`'s own docblock already picked the right answer for
        // the case it does handle: "the driver signs in again, which costs
        // seconds; a crash loop costs the shift." A spinner that never
        // resolves is worse than either.
      } finally {
        // Always. Whatever happened above, the app has finished deciding
        // whether it has a session — and `ready` means exactly that, not
        // "a session was found".
        setReady(true);
      }
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

  const adoptSession = useCallback(async (nextUser: User, token: string) => {
    setCurrentToken(token);
    await writeSession(token, nextUser);
    setUser(nextUser);
  }, []);

  const signOut = useCallback(async () => {
    // Before the token is discarded, because unregistering needs it.
    //
    // This matters more than it looks: a shared depot handset that kept its
    // previous driver's push registration would deliver another person's job
    // offers — pickup address on the lock screen — to whoever holds the phone
    // next (ADR-0025 §4).
    await releasePushRegistration(api);

    // The foreground service and the shift record go with it, for the same
    // reason and with a sharper edge: left running, a depot handset would keep
    // an ongoing "You are online" notification on screen and keep reporting
    // the previous driver's position to the matcher — which would offer them
    // work, from a phone now in somebody else's hands (ADR-0046).
    //
    // Before the token is discarded is not required here, unlike the push
    // registration, but it is where it belongs: everything that makes this
    // handset *this driver's* is released in one place.
    await goOffline();

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
    // Deliberately does *not* unregister the device.
    //
    // This path runs when the server has already rejected the token — an
    // expired session, a password change that revoked everything (ADR-0016).
    // The call would 401, and there is nothing to clean up server-side
    // anyway: every path that revokes a driver's tokens drops their device
    // rows in the same transaction.
    //
    // The local copy is dropped so the next sign-in registers afresh.
    await forgetPushToken();

    // The service is stopped here too, and this path is the one that needs it
    // most: an expired token means the heartbeat is now answering 401 on every
    // tick, so the notification would say "You are online" over a shift the
    // platform stopped recognising hours ago.
    await goOffline();

    setCurrentToken(null);
    setUser(null);
    await clearSession();
  }, []);

  const value = useMemo(
    () => ({ ready, user, api, signIn, adoptSession, signOut, signOutLocally }),
    [ready, user, api, signIn, adoptSession, signOut, signOutLocally],
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
