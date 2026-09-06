import * as Sentry from '@sentry/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect } from 'react';

import { loadNotifications } from '../push/expoNotifications';
import {
  askFirstRunPermissions,
  rememberAskedOnFirstRun,
  shouldAskOnFirstRun,
  type FirstRunPermission,
} from './firstRun';

/**
 * Asks for everything, once, the first time a driver signs in (ADR-0046).
 *
 * Mounted inside the authenticated shell and renders nothing — the same shape
 * as `PushRegistrar` and `PresenceController`, and for the same reason: this
 * must happen wherever the driver lands, not on a screen they might not open.
 *
 * ## Why after sign-in rather than at the very first launch
 *
 * Because a permission dialog in front of somebody who has not yet decided to
 * use the app is a dialog they dismiss. A driver who has just signed in has
 * decided; asking then is answering a question they have already implicitly
 * put. It is also the first moment the app knows there is a driver at all —
 * `PushRegistrar` gates on the same thing for the same reason.
 *
 * ## Why the sequence is the whole point
 *
 * **Android shows each of these dialogs once, ever.** Answered or dismissed,
 * that is the end of it — `requestPermissionsAsync` afterwards resolves denied
 * without showing anything. So this is not "ask early because it is
 * convenient"; it is the single opportunity, and `firstRun.ts` holds the rules
 * that stop it being wasted: one at a time, in an order Android will honour,
 * carrying on past a refusal.
 *
 * ## What it deliberately does not ask for
 *
 * The battery exemption and the lock-screen permission. Both leave the app for
 * Android's own settings, and a first launch that throws a driver into a
 * battery list before they have seen a single screen is how an app gets
 * uninstalled. They live on the Permissions screen, and the lock-screen one is
 * offered at the first Go Online — the moment it means something.
 */
export function FirstRunPermissions() {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!(await shouldAskOnFirstRun()) || cancelled) {
        return;
      }

      // **Written before the dialogs, not after.** There is no callback for "the
      // driver swiped the app away mid-sequence", and re-running it on the next
      // launch would show nothing anyway — every dialog Android had to give has
      // already been given.
      await rememberAskedOnFirstRun();

      const granted = await askFirstRunPermissions(request);

      if (cancelled) {
        return;
      }

      /*
       * Recorded as one line rather than four, and at `info` because a refusal
       * is a choice rather than a fault. What makes it worth having is the
       * *shape*: a fleet where most first runs come back with notifications
       * false is a fleet whose drivers are about to stop getting work, and
       * nothing else in the platform would ever say so.
       */
      Sentry.logger.info('Asked for permissions on first run', {
        notifications: granted.notifications,
        locationWhenInUse: granted.locationWhenInUse,
        locationAlways: granted.locationAlways,
        camera: granted.camera,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

/**
 * The real asks, behind the port `askFirstRunPermissions` takes.
 *
 * Each returns a plain boolean and is allowed to throw — the sequence treats a
 * throw as a refusal and carries on, which is what keeps a missing native
 * module on one permission from costing the other three.
 */
async function request(permission: FirstRunPermission): Promise<boolean> {
  switch (permission) {
    case 'notifications': {
      // Null in Expo Go, on a simulator, or where the module will not load.
      // Thrown rather than returned false so the log reads as "could not ask"
      // rather than "the driver said no" — `askFirstRunPermissions` records
      // both as false, but the distinction is real and worth not erasing here.
      const Notifications = await loadNotifications();

      if (Notifications === null) {
        throw new Error('notifications unavailable on this build');
      }

      return (await Notifications.requestPermissionsAsync()).granted;
    }

    case 'locationWhenInUse':
      return (await Location.requestForegroundPermissionsAsync()).granted;

    case 'locationAlways':
      return (await Location.requestBackgroundPermissionsAsync()).granted;

    case 'camera':
      return (await ImagePicker.requestCameraPermissionsAsync()).granted;
  }
}
