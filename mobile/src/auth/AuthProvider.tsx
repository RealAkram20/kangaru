import * as Sentry from '@sentry/react-native';
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
 * Who every error and every log for the rest of this session is about.
 *
 * One call in each direction — a session begins, a session ends — rather than
 * an attribute repeated at every log site. The SDK attaches `user.id` and
 * `user.email` to everything after this, which is what turns "some handset
 * could not answer an offer" into a driver the office can ring.
 *
 * The email is already in every error event: ADR-0054 §2 sends the request
 * body, and this app's requests carry it. `name` is deliberately not sent —
 * the id is what a report is joined on, and a driver's name adds nothing to a
 * stack trace that their id does not.
 */
function identify(user: User | null): void {
  Sentry.setUser(user === null ? null : { id: String(user.id), email: user.email });
}

/**
 * How long to wait for the keystore before giving up on it.
 *
 * Reading two small values out of Keychain/Keystore is a few milliseconds on
 * any working device, so a wait this long already means something is wrong.
 */
const SESSION_RESTORE_TIMEOUT_MS = 3_000;

/**
 * How long any single step of signing out may take before it is abandoned.
 *
 * Sign-out is three awaited steps — release the push registration, stop the
 * foreground service, tell the server — and each crosses either the network
 * or the native bridge. Any one of them hanging used to hang the whole thing:
 * `user` never cleared, and the app sat on the Profile screen apparently
 * ignoring the tap, on exactly the OEM builds ADR-0046 names as unreliable.
 * Every step is best-effort by its own documentation; none of them may cost
 * the driver the ability to hand the phone over.
 */
const SIGN_OUT_STEP_TIMEOUT_MS = 5_000;

/**
 * A best-effort step: bounded in time, and a rejection means "move on".
 *
 * `withTimeout` alone handles the promise that never settles; the `catch`
 * handles the one that rejects — `forgetPushToken`'s keystore delete, a
 * `goOffline` whose native call throws. Either way the answer is the same:
 * the next step runs, because the local session is coming down regardless.
 */
function bestEffort(step: Promise<unknown>): Promise<unknown> {
  return withTimeout(
    step.catch(() => null),
    SIGN_OUT_STEP_TIMEOUT_MS,
  );
}

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
    // Before the user is cleared, so the log below still carries `user.id`.
    //
    // A token lasts 24 hours with no refresh (ADR-0008), so a driver on a
    // long shift meets this mid-queue: the outbox pauses, every screen falls
    // back to the sign-in gate, and whatever they were part-way through waits.
    // From the office it has always looked like nothing at all.
    Sentry.logger.warn('Session expired; the driver was signed out mid-session');
    identify(null);

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
          identify(session.user);
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
        identify(result.user);

        return { kind: 'signed_in' };
      } catch (error) {
        if (isApiError(error)) {
          // The code, not the message, and not the email: what the office
          // needs from a failed sign-in is whether the credential was
          // rejected, the account suspended, or the request throttled — three
          // different conversations that look identical over the phone.
          Sentry.logger.warn('Sign-in refused', { code: error.code });

          return { kind: 'failed', code: error.code, message: error.message };
        }

        // The other half, and the one a driver upcountry actually meets. It is
        // not a server refusal at all: the request never completed. Counting
        // these separately is what tells a depot's connection problem apart
        // from a forgotten password.
        Sentry.logger.warn('Sign-in could not reach the office', { code: 'OFFLINE' });

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
    identify(nextUser);
  }, []);

  const signOut = useCallback(async () => {
    // Before the token is discarded, because unregistering needs it.
    //
    // This matters more than it looks: a shared depot handset that kept its
    // previous driver's push registration would deliver another person's job
    // offers — pickup address on the lock screen — to whoever holds the phone
    // next (ADR-0025 §4).
    await bestEffort(releasePushRegistration(api));

    // The foreground service and the shift record go with it, for the same
    // reason and with a sharper edge: left running, a depot handset would keep
    // an ongoing "You are online" notification on screen and keep reporting
    // the previous driver's position to the matcher — which would offer them
    // work, from a phone now in somebody else's hands (ADR-0046).
    //
    // Before the token is discarded is not required here, unlike the push
    // registration, but it is where it belongs: everything that makes this
    // handset *this driver's* is released in one place.
    await bestEffort(goOffline());

    try {
      await withTimeout(logoutRequest(api), SIGN_OUT_STEP_TIMEOUT_MS);
    } catch {
      // The token is being discarded either way. A driver who cannot reach the
      // server must still be able to hand the phone over, and the token
      // expires within 24 hours regardless (ADR-0008).
    }

    setCurrentToken(null);
    setUser(null);
    identify(null);
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
    await bestEffort(forgetPushToken());

    // The service is stopped here too, and this path is the one that needs it
    // most: an expired token means the heartbeat is now answering 401 on every
    // tick, so the notification would say "You are online" over a shift the
    // platform stopped recognising hours ago.
    //
    // Bounded like `signOut`'s steps, and this path needs it *more*: it runs
    // on session expiry, so a hang here is a driver who cannot leave a screen
    // the platform has already stopped recognising.
    await bestEffort(goOffline());

    setCurrentToken(null);
    setUser(null);
    identify(null);
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
