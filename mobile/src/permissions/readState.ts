import * as Battery from 'expo-battery';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { readShift } from '../duty/dutyStore';
import { PRESENCE_TASK } from '../duty/PresenceTask';

import { fullScreenIntentIsGrantable } from '../push/fullScreenIntent';
import { loadNotifications, runsInExpoGo } from '../push/expoNotifications';
import type { PermissionStates, PermissionStatus, Reliability } from './permissions';

/**
 * Asking the operating system what this driver has actually allowed.
 *
 * Separated from `permissions.ts` because the two fail differently: that module
 * is arithmetic over states and can be trusted; this one crosses into native
 * code that is absent in Expo Go, absent on a simulator, and different on every
 * OEM. **Every read here is allowed to fail, and a failure reads as
 * `unreadable`** — never as `missing`, because telling a driver a permission is
 * refused when the app simply could not ask is the lie `permissions.ts` exists
 * to prevent.
 *
 * Nothing here prompts. Reading and asking are different acts, and a screen
 * that prompted on open would spend a driver's one chance to say yes before
 * they had read what they were saying yes to.
 */

/** Reads one permission, treating any failure as "we could not find out". */
async function safely(read: () => Promise<boolean>): Promise<PermissionStatus> {
  try {
    return (await read()) ? 'granted' : 'missing';
  } catch {
    return 'unreadable';
  }
}

/**
 * Whether the lock-screen takeover is held, where that can be known at all.
 *
 * **Android 13 and below is a real `granted`, not a guess.**
 * `USE_FULL_SCREEN_INTENT` was an ordinary install-time permission until
 * Android 14, so on those handsets the app holds it by definition —
 * `fullScreenIntentIsGrantable()` returning false *is* the answer, and saying
 * so spares that driver a row telling them to fix something they already have.
 *
 * On Android 14 and above it is genuinely unreadable: the platform call is
 * `NotificationManager.canUseFullScreenIntent()` and neither
 * `expo-notifications` nor `react-native-notify-kit` exposes it
 * (`fullScreenIntent.ts`).
 */
function lockScreenStatus(): PermissionStatus {
  if (Platform.OS !== 'android') {
    // iOS has no equivalent at any privilege level, so there is nothing to
    // hold and nothing to ask for. The screen does not draw this row there.
    return 'unreadable';
  }

  return fullScreenIntentIsGrantable() ? 'unreadable' : 'granted';
}

/**
 * Every permission's state, read fresh.
 *
 * Called on mount and again whenever the app comes back to the foreground —
 * a driver returning from Android's own settings must not be shown the state
 * they left with, which is the single most likely way this screen would lie.
 */
export async function readPermissionStates(): Promise<PermissionStates> {
  const whenInUse = await safely(async () => {
    const { granted } = await Location.getForegroundPermissionsAsync();

    return granted;
  });

  return {
    notifications: await safely(async () => {
      const Notifications = await loadNotifications();

      // Expo Go, a simulator, or a handset that cannot do notifications. There
      // is no permission to report on, so this throws into `unreadable` rather
      // than claiming the driver refused something they were never asked.
      if (Notifications === null) {
        throw new Error('notifications unavailable on this build');
      }

      const { granted } = await Notifications.getPermissionsAsync();

      return granted;
    }),

    locationWhenInUse: whenInUse,

    /*
     * **Gated on while-using, because Android gates it.** "Allow all the time"
     * is not offered until the foreground permission is held, so a driver
     * without it has one problem and one fix — and `blockingJobs` deliberately
     * counts the cause rather than the cause and its consequence.
     */
    locationAlways:
      whenInUse === 'granted'
        ? await safely(async () => {
            const { granted } = await Location.getBackgroundPermissionsAsync();

            return granted;
          })
        : whenInUse === 'unreadable'
          ? 'unreadable'
          : 'blocked',

    // No Expo API reports the exemption, and reading it natively would take a
    // module of our own. `androidSettings.ts` explains why the policy-free
    // intent is what ships.
    battery: 'unreadable',

    lockScreen: lockScreenStatus(),

    camera: await safely(async () => {
      const { granted } = await ImagePicker.getCameraPermissionsAsync();

      return granted;
    }),
  };
}

/**
 * The two things that are true *right now*, which no permission reports.
 *
 * Read together with the permissions and on the same schedule, because a driver
 * flips Battery Saver from the same shade they reach everything else from — the
 * state can change while this screen is open and behind it.
 */
export async function readReliability(): Promise<Reliability> {
  let batterySaver: Reliability['batterySaver'] = 'unknown';

  try {
    batterySaver = (await Battery.isLowPowerModeEnabledAsync()) ? 'on' : 'off';
  } catch {
    // No battery module on this platform, or a handset that will not answer.
    // `unknown` never produces a warning — see `whatIsWrong`.
  }

  let onlineService: Reliability['onlineService'] = 'unknown';

  try {
    const shift = await readShift();

    // **Off duty is not a fault, and saying so is the point.** Nothing runs
    // when nobody has gone online, so reporting "stopped" here would put a red
    // warning on the screen of every driver who has finished their shift.
    if (!shift.onDuty) {
      onlineService = 'off_duty';
    } else if (runsInExpoGo()) {
      /*
       * **Not asked at all in Expo Go, and this is a fix rather than a
       * precaution.** `hasStartedLocationUpdatesAsync` does not throw there —
       * it writes *"Background location is limited in Expo Go: on Android, it
       * is not available at all"* to the console and answers false. So the
       * first version of this reported `stopped`, and the screen told a driver
       * on duty that **"this phone has stopped the app"** when nothing had
       * stopped anything: the service had never been startable in that runtime.
       *
       * Blaming a handset for a limitation of the development runtime is the
       * exact class of lie this screen exists to avoid, and `unknown` is the
       * honest answer — `whatIsWrong` never warns on it.
       *
       * It also silences the warning at source. `observability.ts` deliberately
       * lets the first one through per process, and one fired by *this* screen
       * on every open would drown the one that matters, which is the duty
       * toggle's.
       */
      onlineService = 'unknown';
    } else {
      onlineService = (await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK))
        ? 'running'
        : 'stopped';
    }
  } catch {
    // Treated as unknown rather than stopped: an unreadable task registry must
    // not tell a driver their shift is broken.
  }

  return { batterySaver, onlineService };
}
