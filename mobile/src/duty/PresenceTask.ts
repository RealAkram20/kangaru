import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { sendPresence } from '../api/endpoints';
import { ApiClient } from '../api/client';
import { isApiError } from '../api/errors';
import { readSession } from '../auth/tokenStore';
import { API_BASE_URL } from '../config';
import { readShift } from './dutyStore';
import { reportPresence } from './presence';

/**
 * The name the OS knows this task by. Changing it orphans any task already
 * registered on a handset in the field, which then runs forever under the old
 * name with no code behind it — so it is a constant, exported, and used by
 * `OnlineService` rather than retyped.
 */
export const PRESENCE_TASK = 'kangaruride.driver.presence';

/**
 * Reports where a driver is while the app is not on screen (ADR-0024 §2).
 *
 * ## Why this exists, and what was broken without it
 *
 * `PresenceController` is a `setInterval` inside a React component. Android
 * throttles those within minutes of the app being backgrounded and stops them
 * entirely when the process is trimmed, and `dispatch.presence_ttl_seconds` is
 * 180 — so **a driver whose phone went into their pocket dropped out of the
 * dispatch pool three minutes later while their screen still read "You are
 * online".** Nothing appeared broken. `DutyBar`'s own docblock names that as
 * the worst bug this feature can have, and it was live.
 *
 * ## Why it is defined at module scope
 *
 * `TaskManager.defineTask` must run during the JavaScript bundle's evaluation,
 * before React mounts anything. When the OS cold-starts the app *into* this
 * task — which is the entire point of it — there is no component tree, and a
 * task defined inside a `useEffect` simply does not exist yet. The symptom is
 * an `expo-task-manager` warning in logcat and a heartbeat that works
 * perfectly in every test and never once in a pocket.
 *
 * `index.ts` imports this file for that reason, and the import is not
 * incidental.
 *
 * ## Why the fix arrives rather than being fetched
 *
 * `Location.startLocationUpdatesAsync` hands its positions to this task, so
 * there is nothing to ask for: the OS already spent the GPS wake. Calling
 * `getCurrentPositionAsync` here would pay for a second fix on a schedule the
 * driver's battery is already funding once.
 *
 * It also settles the permission question. A location we were *given* is
 * proof of a permission we hold, which is why `hasPermission` below is a
 * constant rather than a native call — and why nothing here ever prompts.
 */
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  PRESENCE_TASK,
  async ({ data, error }) => {
    // The OS reporting a failure of its own — a revoked permission, location
    // services switched off mid-shift. There is no position to send and
    // nothing a driver could be told from here, so it ends quietly. The
    // foreground app is what surfaces this, through the server's own
    // `dispatchable` flag on the duty bar.
    if (error !== null || data?.locations === undefined) {
      return;
    }

    // The **last** one, not the first and not all of them. The OS batches
    // positions it collected while the radio was asleep, and only the newest
    // has any use for a dispatch radius — sending the older ones would rank a
    // driver from a place they have already left, which is the exact failure
    // `presence_ttl_seconds` exists to prevent.
    const fix = data.locations[data.locations.length - 1];

    if (fix === undefined) {
      return;
    }

    const [session, shift] = await Promise.all([readSession(), readShift()]);

    // Signed out, or off duty as far as this handset knows. Either way there
    // is nobody to report for. `OnlineService.stop()` should already have
    // torn the updates down; this is the belt to its braces, because a task
    // that outlives its reason is one that pings the platform from a phone in
    // a drawer.
    if (session === null || !shift.onDuty) {
      return;
    }

    const api = new ApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.token,
      // Deliberately no `onUnauthenticated`. That callback exists to drive the
      // sign-out flow through `AuthProvider`, and there is no provider here —
      // wiring it to `clearSession` instead would sign a driver out from a
      // background task, mid-shift, with no way for them to see why. A dead
      // token stops the heartbeat and the next foreground launch handles it
      // properly, in front of somebody who can read the screen.
    });

    const outcome = await reportPresence(
      {
        hasPermission: async () => true,
        getFix: async () => ({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracyMetres: fix.coords.accuracy ?? null,
          timestamp: fix.timestamp,
        }),
        // The short duty timeout lives inside `sendPresence` itself, so both
        // callers get it and neither has to remember.
        send: (input) => sendPresence(api, input),
        isNotOnDuty: (thrown) => isApiError(thrown) && thrown.code === 'NOT_ON_DUTY',
      },
      shift.vehicleId,
    );

    // **The server is the authority on duty state, and this is where it wins.**
    // A 409 means the shift ended somewhere this handset did not see — a
    // dispatcher signed the driver off, a suspension landed, the account was
    // detached. Left running, the service would hold a wake lock and a
    // notification saying "You are online" for a driver the platform has
    // stopped offering work to, which is worse than being offline because it
    // is confidently wrong.
    //
    // Stopping is safe in the other direction too: `useDuty` polls, and the
    // foreground app restarts the service the moment it disagrees.
    if (outcome.kind === 'off_duty') {
      await stopPresenceUpdates();
    }
  },
);

/**
 * Tears the updates down, if any are running.
 *
 * Lives here rather than in `OnlineService` because the task itself needs it —
 * see the 409 handling above — and importing the service from the task would
 * close a cycle. Checking `hasStartedLocationUpdatesAsync` first is not
 * defensive noise: stopping a task that was never started throws on Android.
 */
export async function stopPresenceUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK)) {
      await Location.stopLocationUpdatesAsync(PRESENCE_TASK);
    }
  } catch {
    // The service is already gone, or the OS reclaimed it. Either way the
    // desired state has been reached.
  }
}
