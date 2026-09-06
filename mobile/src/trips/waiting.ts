import type { TripEvent } from '../api/types';

/**
 * How long the driver has been standing at the pickup.
 *
 * ## Where the number comes from, and why not from anywhere else
 *
 * The append-only timeline, exactly as billing does it. AGENTS.md, Trip State
 * Machine: *"Waiting-time billing is computed from `trip_events`, never from a
 * mutable column."* `WaitingTimeCalculator` obeys that on the server and this
 * obeys it on the handset — the moment the driver arrived is the moment the
 * transition into `driver_arrived` was recorded, and nothing else on the trip
 * can answer it. `started_at` is Trip Started, which has not happened yet.
 *
 * The alternative — stamping a local clock when the screen mounts — was
 * rejected, and the failure is not subtle: a driver who backgrounds the app to
 * ring the passenger and comes back would see the timer restart at zero, on a
 * screen whose entire purpose is telling them how long they have been there.
 *
 * ## What this deliberately is not
 *
 * A countdown. Nothing in this platform bounds a wait at the kerb: the rate
 * card's `free_waiting_minutes` and `per_waiting_minute_minor` bill the
 * *in-trip* Waiting status — `WaitingTimeCalculator` opens a period on a
 * transition **into** `TripStatus::WAITING`, which the graph only permits
 * after Trip Started — and `TripPolicy` withholds `no_show` from a driver, so
 * nothing follows from any amount of elapsed time. `fillFraction` therefore
 * saturates at 1 and stays there rather than wrapping, resetting or expiring.
 */

/** The em dash every screen in this app uses for a figure it does not have. */
export const NO_VALUE = '—';

/**
 * When the driver arrived, in epoch milliseconds, or null.
 *
 * Null is a real answer and not an error: the timeline is served by a second
 * request, so it is legitimately absent while that is in flight, and offline
 * it may be a cache taken before the arrival was posted. Callers render
 * `NO_VALUE` rather than substituting a zero — an elapsed time of `00:00`
 * would tell a driver who has been waiting eight minutes that they just got
 * there.
 *
 * The **last** matching event wins. The state graph has no path back into
 * `driver_arrived`, so there should only ever be one; taking the last is
 * simply the answer that stays correct if that ever changes, at no cost.
 */
export function arrivedAtFrom(events: TripEvent[] | undefined): number | null {
  return momentOfTransition(events, 'driver_arrived');
}

/**
 * When a trip entered a given status, in epoch milliseconds, or null.
 *
 * The general form of `arrivedAtFrom`, extracted when the trip-in-progress
 * screen needed the same question asked about `trip_started`. One reader of
 * the timeline rather than two: the null handling and the unparseable-date
 * case are the fiddly parts, and having them in two places is having them
 * right in one and a half.
 *
 * The **last** matching event wins. Today's state graph has no path back into
 * either status this is asked about, so there should only ever be one; taking
 * the last is simply the answer that stays correct if a future lifecycle
 * allows a second, at no cost.
 *
 * A null `created_at` or an unparseable one is skipped rather than treated as
 * a match with no time — a transition the app cannot place in time is one it
 * cannot count from.
 */
export function momentOfTransition(
  events: TripEvent[] | undefined,
  status: TripEvent['to_status'],
): number | null {
  if (events === undefined) {
    return null;
  }

  let moment: number | null = null;

  for (const event of events) {
    if (event.to_status !== status || event.created_at === null) {
      continue;
    }

    const parsed = Date.parse(event.created_at);

    if (!Number.isNaN(parsed)) {
      moment = parsed;
    }
  }

  return moment;
}

/**
 * Whole seconds between arrival and now.
 *
 * **Clamped at zero, because the two clocks are not the same clock.**
 * `arrivedAt` is the server's, `now` is the handset's, and a cheap phone whose
 * time has drifted behind the server produces a negative difference. Rendering
 * that would put `-00:07` on the screen — a number no driver can act on, from
 * a fault they cannot see. Zero is the honest floor: it says "no time yet",
 * which is at worst briefly early.
 *
 * The drift in the other direction cannot be corrected from here, and is not
 * pretended away: a handset running fast simply over-reports, which is why
 * nothing in this platform bills from this figure.
 */
export function elapsedSeconds(arrivedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - arrivedAt) / 1000));
}

/**
 * How much of the ring is drawn, from 0 to 1.
 *
 * Saturates. Past the target the ring is full and *stays* full while the
 * figure below it keeps counting — the one rendering that does not imply a
 * deadline, because there is none (see the module docblock). A ring that
 * emptied and began again would read as a second period starting, and a ring
 * that stopped being drawn would read as the wait being over.
 *
 * A target of zero or less would be a division by zero, and there is no
 * meaningful arc for "the expected wait is nothing" — it is drawn full, which
 * is where any positive elapsed time would put it anyway.
 */
export function fillFraction(elapsed: number, targetSeconds: number): number {
  if (targetSeconds <= 0) {
    return 1;
  }

  return Math.min(1, Math.max(0, elapsed / targetSeconds));
}

/**
 * `mm:ss`, with the minutes left unbounded.
 *
 * A wait that reaches an hour reads `61:04` rather than rolling over to
 * `01:04`, which would be indistinguishable from one minute — the exact
 * failure a driver in a dispute would be arguing about. Hours are not
 * introduced as a third field because the overwhelmingly common case is under
 * ten minutes, and a permanent `00:` in front of every reading costs
 * legibility on the glance this screen exists for.
 */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;

  return `${pad(minutes)}:${pad(remainder)}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * The whole waiting figure, for a screen reader, as one sentence.
 *
 * Composed here rather than left to the ring, because a `52`, a `:` and a `07`
 * linearise into three announcements of nothing. The rules file asks for one
 * sensible announcement per screen for exactly this reason.
 */
export function waitingAnnouncement(seconds: number | null): string {
  if (seconds === null) {
    return 'Waiting time is not available yet.';
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];

  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }

  // Suppressed only when it would follow whole minutes — "3 minutes" reads
  // better than "3 minutes 0 seconds", but a wait under a minute still needs
  // its seconds or the sentence says nothing at all.
  if (remainder > 0 || minutes === 0) {
    parts.push(`${remainder} ${remainder === 1 ? 'second' : 'seconds'}`);
  }

  return `Waiting ${parts.join(' ')}.`;
}
