import type { DrainOutcome } from './outbox';

/**
 * Whether the queue is trying and getting nowhere.
 *
 * ## The distinction `online` cannot make
 *
 * `SyncBanner` had one signal for this and it was NetInfo's `online`, which
 * knows about the internet and not about this API. A phone on depot wifi with
 * the office unreachable is `online: true` with a queue that never moves — and
 * the banner said **"Sending 3 updates…"** over it while the count climbed
 * from one to three. The owner's screenshot; the API was down.
 *
 * "Sending" is a claim of progress, and a driver who reads it concludes the
 * office has their work. `docs/screen-rules.md` §1 forbids stating a value the
 * platform cannot produce, and progress is a value like any other.
 *
 * ## An observation, not a probe
 *
 * There is deliberately no health endpoint behind this. A reachability ping
 * would be a second network call every tick to tell a driver something the
 * queue already knows: **whether anything went out.** `DrainOutcome` carries
 * that, and reading it costs nothing.
 *
 * `deferred` counts everything left behind for any reason — a failed post, an
 * item waiting out its backoff, an item held behind a stalled stream — so this
 * does not claim to know *why* nothing moved. It only reports that nothing
 * did, which is exactly what the banner needs to stop over-claiming.
 *
 * Extracted from `SyncProvider` to be testable at all: the provider needs
 * SQLite, NetInfo and a live API, and this is the only part of it with a
 * decision in it.
 */

/**
 * How many fruitless passes before the banner stops saying "Sending".
 *
 * Two, which at the fifteen-second outbox tick is about thirty seconds — long
 * enough that one slow post or a single item waiting out its backoff does not
 * change the wording, short enough that a driver is not told their work is
 * going out for minutes while it is not.
 */
export const FRUITLESS_DRAINS_BEFORE_STALLED = 2;

/**
 * The run of fruitless passes after this one, given the run before it.
 *
 * @param previous The count before this drain.
 * @param outcome  What the drain actually achieved.
 */
export function fruitlessRun(previous: number, outcome: DrainOutcome): number {
  // A paused processor is a 401, not an unreachable office. It has its own
  // path through `onSessionExpired`, and "can't reach the office" is the wrong
  // sentence for a session that needs signing in again.
  if (outcome.paused) {
    return 0;
  }

  // Anything at all got through, so the office is there.
  if (outcome.completed > 0) {
    return 0;
  }

  // Nothing moved, and there was something to move.
  if (outcome.deferred > 0) {
    return previous + 1;
  }

  // An idle queue is not a stalled one. Without this the banner would appear
  // over every screen in the app the moment a drain found nothing to do.
  return 0;
}

/** Whether a run that long is worth changing the wording for. */
export function isStalled(fruitless: number): boolean {
  return fruitless >= FRUITLESS_DRAINS_BEFORE_STALLED;
}
