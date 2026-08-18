import * as SecureStore from 'expo-secure-store';

import type { User } from '../api/types';

const TOKEN_KEY = 'kangaruride.driver.token';
const USER_KEY = 'kangaruride.driver.user';

/**
 * The session, in the platform keystore.
 *
 * SecureStore rather than AsyncStorage, and the reason is ADR-0022's own
 * threat model: it scopes the driver token because "a credential at rest in
 * the wrong place" — a stolen handset, a mobile app's storage, a cloud
 * backup — is the thing it defends against. Storing that token in plain
 * AsyncStorage would put it in exactly the place the ADR is worried about.
 * Keychain and Keystore are excluded from device backups.
 *
 * The user record sits beside it so the app can render a name at launch
 * before `GET /auth/me` answers. It is a cache, never an authority: the
 * server's copy wins on every refresh.
 */
export async function readSession(): Promise<{ token: string; user: User } | null> {
  const [token, serialisedUser] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);

  if (token === null || serialisedUser === null) {
    return null;
  }

  try {
    return { token, user: JSON.parse(serialisedUser) as User };
  } catch {
    // A half-written or format-changed record. Treated as signed out rather
    // than crashing the launch — the driver signs in again, which costs
    // seconds; a crash loop costs the shift.
    return null;
  }
}

export async function writeSession(token: string, user: User): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
  ]);
}

/**
 * Clears the credential and nothing else.
 *
 * The outbox is deliberately untouched. A token expires after 24 hours
 * (ADR-0008) with no refresh, so signing out and in again is a routine event
 * on a long shift, and it must not take a captured odometer reading with it
 * (ADR-0023 §6).
 */
export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
