import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_TOKEN_KEY = 'kangaruride.driver.pushToken';

/**
 * The last push token this install registered (ADR-0025 §4).
 *
 * ## AsyncStorage, not SecureStore
 *
 * Deliberately different from `auth/tokenStore.ts`, which uses the platform
 * keystore because ADR-0022's threat model is a bearer credential at rest on
 * a lost handset. A push token is not a credential: it authorises nothing,
 * grants no access, and is worthless to anybody who does not also hold the
 * project's push credentials. Putting it in the keystore would imply it
 * needs the same protection and cost a native call on every launch.
 *
 * ## Why it is stored at all
 *
 * So sign-out can unregister *this* token specifically. Re-deriving it at
 * that moment is not an option: `getExpoPushTokenAsync` needs a network
 * round trip, and a driver signing off at the end of a shift is often in a
 * basement car park — exactly when the handset most needs to stop receiving
 * somebody else's job offers.
 */
export async function rememberPushToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    // Losing this costs one stale row on the server, which the push service
    // prunes on its next `DeviceNotRegistered`. Not worth failing a sign-in.
  }
}

export async function readPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function forgetPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // Nothing useful to do. The row is already unregistered server-side by
    // the time this runs, and a stale local copy is re-overwritten on the
    // next sign-in.
  }
}