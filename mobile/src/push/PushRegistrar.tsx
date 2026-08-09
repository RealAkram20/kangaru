import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerDevice } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { rememberPushToken } from './tokenStore';

/**
 * Registers this handset for job offers (ADR-0025 §4).
 *
 * Mounted once inside the authenticated shell and renders nothing — the same
 * shape as `GpsController` and `PresenceController`, and for the same reason:
 * a driver who never opens a particular screen must still be reachable.
 *
 * ## Everything here is allowed to fail
 *
 * A refused permission, a simulator with no push support, an Expo project id
 * that is not configured yet — none of them is an error worth showing a
 * driver, and none of them stops the app working. ADR-0025 §3 is what makes
 * that true: push shortens the latency and is not the transport. Offers are
 * at `GET /me/offers`, which the app polls every five seconds while on duty.
 *
 * So this is best-effort by construction. The failure it must avoid is the
 * opposite one — an app that refuses to start because a notification service
 * was unreachable.
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
        // A simulator has no push token to give, and asking produces an
        // error rather than a refusal. Checked first so the common
        // development case is silent instead of noisy.
        if (!Device.isDevice) {
          return;
        }

        const existing = await Notifications.getPermissionsAsync();
        const granted =
          existing.granted || (await Notifications.requestPermissionsAsync()).granted;

        // A driver may say no, and the app must work when they do — it polls.
        // Asking again on every launch would be nagging for a capability the
        // platform does not require.
        if (!granted || cancelled) {
          return;
        }

        const { data: token } = await Notifications.getExpoPushTokenAsync();

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