import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerDevice } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { ensureNotificationChannels } from './channels';
import { loadNotifications, pushUnavailableReason } from './expoNotifications';
import { rememberPushToken } from './tokenStore';

/**
 * Whether the build-capability refusal has already been reported this process.
 *
 * `expo_go` and `simulator` are facts about the *build*, fixed for the life of
 * the process — so reporting one on every sign-in would be the same sentence
 * repeated at whatever rate drivers sign in, which is how a log stops being
 * read. The other two outcomes below are not module-scoped, deliberately: a
 * refused permission and a failed token call can both change between sign-ins,
 * and each occurrence is a separate fact.
 */
let buildRefusalReported = false;

/**
 * Test seam. Nothing in the app calls this.
 *
 * Same shape as `resetCallLaunchForTest` next door, and needed for the same
 * reason: a module-scoped "already said this" flag survives between tests in
 * one file, so the second assertion in a suite would read the first one's
 * state rather than its own.
 */
export function resetPushRegistrarForTest(): void {
  buildRefusalReported = false;
}

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
        /*
         * **Asked before `loadNotifications`, so the answer can be reported.**
         *
         * This used to be a bare `if (Notifications === null) return;` with a
         * comment saying null "is not a failure to report". That sentence is
         * true about the *driver* — there is nothing they could do — and it was
         * catastrophically wrong about the office. It is the line the whole
         * outside-the-app path died behind: every handset ran in Expo Go, none
         * ever reached `getExpoPushTokenAsync`, `device_tokens` stayed empty for
         * the entire fleet, and thirty-eight job offers were dispatched to
         * nobody. Nothing crashed and nothing was slow, which is exactly the
         * failure class `observability.ts` says this app exists to log.
         *
         * `error`, not `warn`, and level-matched on purpose: a refused
         * foreground service is already `Sentry.logger.error` in
         * `useDutyToggle`, and this is the same severity of fact — a driver who
         * will be offered work they cannot hear.
         */
        const unavailable = pushUnavailableReason();

        if (unavailable !== null) {
          if (!buildRefusalReported) {
            buildRefusalReported = true;

            Sentry.logger.error('This build cannot receive job offers in the background', {
              // `expo_go` means a development build is missing, and it takes
              // the foreground service and the call notification with it —
              // not push alone. `simulator` is ordinary and must not read as
              // a fleet outage, which is why the two are told apart at all.
              reason: unavailable,
              platform: Platform.OS,
            });
          }

          return;
        }

        // Null here is now something else entirely: the module itself would not
        // import, on a handset that passed every capability check above. Rare,
        // and worth its own line rather than sharing one with Expo Go.
        const Notifications = await loadNotifications();

        if (Notifications === null) {
          Sentry.logger.error('The notifications module would not load on a handset that supports it');

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
        //
        // **But the office is told, once per sign-in.** A driver who declined
        // this is a driver who will be offered jobs and hear none of them, and
        // until they are visible somewhere the only way to find out is for them
        // to ring in and say they are getting no work. Not module-scoped like
        // the build refusal above: this can change between sign-ins, in either
        // direction, from Android's own settings.
        if (!granted) {
          Sentry.logger.error('Notification permission refused; jobs cannot reach this phone in the background', {
            platform: Platform.OS,
          });

          return;
        }

        if (cancelled) {
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
      } catch (error) {
        /*
         * **Still silent on screen, and no longer silent everywhere.**
         *
         * The original comment is kept because its reasoning holds: no cause
         * here is something a *driver* can act on mid-shift, and the app must
         * not appear broken. What it got wrong is treating "nothing to show the
         * driver" as "nothing to record" — this catch swallowed the missing EAS
         * project id for the entire life of the feature, which is written into
         * `getExpoPushTokenAsync`'s own comment below as the reason push "has
         * never once worked on this app".
         *
         * The message is captured rather than the exception: this runs on a
         * launch path where a `captureException` would raise an issue per
         * handset per sign-in for what is usually one fleet-wide misconfiguration.
         */
        Sentry.logger.error('Push registration failed; jobs cannot reach this phone in the background', {
          platform: Platform.OS,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void register();

    return () => {
      cancelled = true;
    };
  }, [api, user]);

  return null;
}