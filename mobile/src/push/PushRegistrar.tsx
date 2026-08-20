import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerDevice } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { ensureNotificationChannels } from './channels';
import { loadNotifications } from './expoNotifications';
import { rememberPushToken } from './tokenStore';

/**
 * Registers this handset for job offers (ADR-0025 §4).
 *
 * Mounted once inside the authenticated shell and renders nothing — the same
 * shape as `GpsController` and `PresenceController`, and for the same reason:
 * a driver who never opens a particular screen must still be reachable.
 *
 * ## Why `expo-notifications` is imported dynamically
 *
 * **Expo Go cannot do push at all since SDK 53**, and the module does not
 * fail politely: importing it registers a token listener at module scope,
 * which throws `[runtime not ready]` and takes the entire app down before a
 * single screen renders. A static import here bricked the app in Expo Go —
 * the one environment the driver flow is demonstrated in.
 *
 * So the import lives inside the effect, behind the Expo Go check below, and
 * never executes there. Everything else in the app is unaffected.
 *
 * ## Everything here is allowed to fail
 *
 * A refused permission, a simulator, an Expo Go session, an unconfigured
 * project id — none is an error worth showing a driver, and none stops the
 * app working. ADR-0025 §3 is what makes that true: push shortens the
 * latency and is not the transport. Offers are at `GET /me/offers`, which
 * the app polls every five seconds while on duty.
 *
 * That is not a consolation here, it is the design working as intended: in
 * Expo Go the driver gets every offer, five seconds later than a push would
 * have delivered it.
 */
export function PushRegistrar() {
  const { api, user } = useAuth();

  useEffect(() => {
    if (user === null) {
      return;
    }

    let cancelled = false;

    const register = async () => {
      try {
        // Expo Go and simulators are excluded inside `loadNotifications`,
        // before anything touches the module — see the note above and the
        // reasoning in `expoNotifications.ts`. Null means this handset does
        // not do notifications, which is not a failure to report.
        const Notifications = await loadNotifications();

        if (Notifications === null) {
          return;
        }

        // **Before the permission prompt, not after.** The channel is what
        // carries the ringtone and the heads-up behaviour, and on Android the
        // settings screen a driver lands on from the permission dialog lists
        // channels — one that does not exist yet cannot be found there, and a
        // driver who goes looking for "Job offers" and sees nothing concludes
        // the app has none. Creating it costs nothing when it already exists.
        await ensureNotificationChannels();

        const existing = await Notifications.getPermissionsAsync();
        const granted =
          existing.granted || (await Notifications.requestPermissionsAsync()).granted;

        // A driver may say no, and the app must work when they do — it polls.
        // Asking again on every launch would be nagging for a capability the
        // platform does not require.
        if (!granted || cancelled) {
          return;
        }

        // **The project id is passed explicitly, and it is the reason push
        // has never once worked on this app.**
        //
        // `getExpoPushTokenAsync` needs an EAS project id. It reads one from
        // `expoConfig.extra.eas.projectId` when none is given — and `app.json`
        // had no such key, so this call threw `No "projectId" found`, the
        // catch below swallowed it, and the app reported nothing. Every other
        // part of the push path was correct and untestable behind it.
        //
        // Naming it here does not fix a missing id; it makes the dependency
        // visible at the call site instead of buried in a library's fallback,
        // so the next person reads it in the code rather than deducing it
        // from silence. `eas init` writes the key.
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

        const { data: token } = await Notifications.getExpoPushTokenAsync(
          projectId === undefined ? undefined : { projectId },
        );

        if (cancelled) {
          return;
        }

        await registerDevice(api, {
          token,
          platform: Platform.OS,
          // What version produced this token, so the fleet office can tell a
          // handset that has not been updated from one that has gone quiet.
          appVersion: Device.osVersion,
        });

        // Kept so sign-out can unregister *this* token specifically.
        // Re-reading it at sign-out is not an option: the account is already
        // being torn down, and `getExpoPushTokenAsync` needs a network round
        // trip that a driver signing off in a basement will not get.
        await rememberPushToken(token);
      } catch {
        // Deliberately silent. Every cause is either a permission the driver
        // chose, a device that cannot do this, or a service that is down —
        // and none of them is something a driver can act on. The one thing
        // that must not happen is the app appearing broken because of it.
      }
    };

    void register();

    return () => {
      cancelled = true;
    };
  }, [api, user]);

  return null;
}