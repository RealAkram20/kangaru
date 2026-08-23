import * as Location from 'expo-location';

import { rememberShift, forgetShift, type Shift } from './dutyStore';
import { PRESENCE_TASK, stopPresenceUpdates } from './PresenceTask';
import { annotate, traced } from '../tracing';
import { runsInExpoGo } from '../push/expoNotifications';

/**
 * Keeps the app alive for as long as the driver is online (ADR-0024 §2).
 *
 * ## What this actually is, and why it is location and not a timer
 *
 * On Android this starts a **foreground service** — the ongoing, undismissable
 * notification a driver sees while they are on shift. That service is the
 * keystone of everything else in this feature: while it runs the process
 * survives, so the presence heartbeat keeps its cadence, a push handler fires
 * when a job arrives, and a ringtone can be started from JavaScript. Without
 * it Android trims the process and all three stop, silently.
 *
 * There is no general "keep my app running" API — Android grants that only for
 * a declared, user-visible purpose. Location is the honest one here, because
 * it is what the app is genuinely doing: reporting a dispatch radius to the
 * matcher. This is not a service invented as a pretext for a wake lock, which
 * matters practically as well as ethically — Google Play requires the use case
 * to be declared and reviewed, and "ride tracking for ride share" is on their
 * approved list where "stay awake for notifications" is not.
 *
 * On iOS there is no equivalent. `UIBackgroundModes: location` keeps the app
 * receiving positions, but the system may still suspend it, and push is what
 * wakes it for a job. That asymmetry is real and is recorded in ADR-0046
 * rather than papered over.
 *
 * ## Why the cadence is coarse
 *
 * `distanceInterval: 0` and the server's own `heartbeat_seconds`, which is 60
 * by default. ADR-0024 §2 is explicit that this is a *dispatch radius sampled
 * for a ranking*, not the trip GPS trace, which is billing evidence sampled at
 * ten seconds by `GpsStreamer`. Running the fine-grained one all day to answer
 * the coarse question is how a driver's battery dies before lunch — and a
 * driver whose battery died is off duty for the rest of the shift whatever the
 * database thinks.
 */

/** Seconds. Android treats this as a floor, not a promise; iOS largely ignores it. */
function intervalMs(shift: Shift): number {
  return Math.max(15, shift.heartbeatSeconds) * 1000;
}

/**
 * Goes online: writes the shift down, then asks the OS for the service.
 *
 * **Order matters.** The record is written first because
 * `startLocationUpdatesAsync` can deliver its first position immediately, and
 * a task that wakes before the shift exists reads `onDuty: false` and returns
 * without reporting — costing the driver the first interval of their shift,
 * which is the interval in which they are most likely to be offered the job
 * they opened the app for.
 *
 * Returns false when the OS refused. **A refusal must not block the shift**:
 * ADR-0024 §2 keeps a driver dispatchable without coordinates and ranks them
 * without distance, so the caller reports it and carries on. Treating this as
 * fatal would be the app inventing a rule the platform does not have.
 */
export async function goOnline(shift: Shift): Promise<boolean> {
  /*
   * Traced (ADR-0054 §4). Not the HTTP call that starts the shift — the SDK
   * already times that — but the **native** half, which nothing has ever
   * timed and which is where the Go Online button actually stalls: a
   * keystore-backed write, a permission check, and
   * `startLocationUpdatesAsync`, which on some Android OEMs takes seconds to
   * bring up a foreground service and on others quietly refuses.
   *
   * `refused` is the attribute that makes it worth reading. This function
   * swallows the failure by design — ADR-0024 §2 keeps a driver dispatchable
   * without coordinates, so a refusal must not block the shift — which means
   * a driver can be online, invisible to the matcher, and nothing anywhere
   * says so. On the span it is one boolean.
   */
  return traced('duty.go_online', 'start reporting position', async () => {
    const started = await startPresence(shift);

    // The cadence rides along because it is what the OS was asked for:
    // `intervalMs(shift)` is derived from it, and a slow start on a
    // five-second heartbeat is a different finding from a slow start on
    // thirty.
    annotate({ refused: !started, heartbeat_seconds: shift.heartbeatSeconds });

    return started;
  });
}

async function startPresence(shift: Shift): Promise<boolean> {
  await rememberShift(shift);

  try {
    // Starting twice throws, and this is genuinely reachable: the duty query
    // polls, and any refetch that re-runs the effect would otherwise stack a
    // second service on the first.
    if (await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK)) {
      return true;
    }

    await Location.startLocationUpdatesAsync(PRESENCE_TASK, {
      // Balanced, not `High`. Street-level accuracy is all a ranking needs,
      // and `High` pins the GPS radio on for the whole shift.
      accuracy: Location.Accuracy.Balanced,
      timeInterval: intervalMs(shift),
      distanceInterval: 0,
      // A parked driver at a stage waiting for work is the *most* important
      // one to keep reporting — they are the one the matcher should be
      // offering jobs to. Letting the OS pause updates because the phone
      // stopped moving would take exactly that driver out of the pool.
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      // iOS: the blue status bar. Deliberately shown — a driver is entitled to
      // know their position is being reported, and hiding it would be the
      // opposite of the honesty the Android notification is forced into.
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'You are online',
        notificationBody: 'Waiting for jobs. Tap to open KangaruRide.',
        // `navy`, the brand's chrome colour, rather than the green: this is a
        // status notification and not a call to action, and the green is
        // reserved for the offer that will interrupt it.
        notificationColor: '#001028',
        // The service dies with the app rather than being restarted by the OS
        // behind a driver who swiped the app away. Someone who dismisses
        // KangaruRide from their recents has said something, and resurrecting
        // ourselves to keep a notification on their phone is how an app earns
        // a force-stop — after which it receives nothing at all.
        killServiceOnDestroy: true,
      },
    });

    return true;
  } catch {
    // Permission refused, location services off, or an OEM that simply says
    // no. None of these is worth an exception here: the caller has a driver
    // waiting on a toggle, and the shift is the server's to start.
    return false;
  }
}

/**
 * Whether the foreground service is running right now, where that can be known.
 *
 * **Null is "we could not find out", and it is not the same as false.** In Expo
 * Go `hasStartedLocationUpdatesAsync` does not throw — it writes *"Background
 * location is limited in Expo Go"* to the console and answers false, which
 * would have every launch there look like a shift that had died. A read that
 * throws is treated the same way, because the one thing a caller must never do
 * is end a real shift because a task registry would not answer.
 *
 * This is the ground truth behind the duty toggle: every permission on the
 * Permissions screen exists only to keep this running, so a single boolean here
 * says more about whether a job can arrive than any of them.
 */
export async function serviceIsRunning(): Promise<boolean | null> {
  if (runsInExpoGo()) {
    return null;
  }

  try {
    return await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK);
  } catch {
    return null;
  }
}

/**
 * Goes offline, and leaves nothing behind.
 *
 * Both halves matter and they fail independently, so neither is allowed to
 * skip the other. A stopped service with the shift record still saying
 * `onDuty` would have the next OS-delivered position report for a driver who
 * has gone home; a cleared record with the service still running holds a wake
 * lock and a notification for no reason.
 */
export async function goOffline(): Promise<void> {
  await Promise.all([stopPresenceUpdates(), forgetShift()]);
}
