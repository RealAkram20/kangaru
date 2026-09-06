/**
 * What a shift the app did not start is worth (ADR-0024 §2).
 *
 * ## The bug this exists to end
 *
 * Duty lives on the server, so `GET /me/duty` answers "on duty" long after the
 * handset that started the shift has been rebooted, force-stopped or simply
 * killed by Android. `PresenceController` faithfully writes that down and
 * `DutyBar` faithfully draws **"You are online"** — and nothing has called
 * `Location.startLocationUpdatesAsync`, because that only happens when a driver
 * *taps* Go Online.
 *
 * So after every cold start there was no foreground service, no heartbeat, and
 * the driver dropped out of the dispatch pool `presence_ttl_seconds` later
 * while their screen still said they were working. It is exactly the state
 * `DutyBar`'s own docblock calls the worst bug this feature can have, and it
 * was observed rather than theorised: the demo driver sat at `on_duty = 1` with
 * a position **four and a half hours old**.
 *
 * ## The rule, and why "go offline" beats "restart the service"
 *
 * Restarting the service on launch was the tempting fix and it is the wrong
 * one. It would put a driver back on duty without them asking — after a reboot,
 * after a force-stop, at seven in the morning when the phone came off charge —
 * and duty is the one act in this app that must be deliberate. `OnlineService`
 * holds a wake lock and reports position; starting that on the app's own
 * initiative is how an app earns a force-stop, after which it receives nothing
 * at all.
 *
 * So the app tells the truth instead: **the service either runs or the driver
 * is off duty.** A toggle that says online when nothing is running is worse
 * than one that says offline, because the second is a thing a driver can fix in
 * one tap and the first is a thing they cannot see.
 */

export type LaunchDuty = {
  /** What `GET /me/duty` says. */
  serverSaysOnDuty: boolean;
  /**
   * Whether the location foreground service is actually running.
   *
   * `null` where it cannot be known — Expo Go, or a read that failed. Never
   * treated as "not running": ending a real shift because a task registry would
   * not answer would take a working driver off the road.
   */
  serviceRunning: boolean | null;
};

/**
 * Whether the app should end this shift as it starts.
 *
 * True only for the state that is definitely a lie: the server believes the
 * driver is working, and this handset is definitely not doing the work.
 *
 * Deliberately false when `serviceRunning` is null. The cost of getting that
 * wrong the safe way is a driver who has to tap Go Online again; the cost the
 * other way is a shift ended under someone who is mid-job.
 */
export function shouldEndShiftOnLaunch({ serverSaysOnDuty, serviceRunning }: LaunchDuty): boolean {
  return serverSaysOnDuty && serviceRunning === false;
}
