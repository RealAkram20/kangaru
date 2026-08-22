import { isApiError, isOutcomeUnknown } from '../api/errors';
import { annotate, traced } from '../tracing';
import type { AvailabilityBlock, Trip } from '../api/types';
import type {
  AvailabilityRequestPayload,
  AvailabilityWithdrawPayload,
  OutboxItem,
  OutboxStore,
  TransitionPayload,
} from './outboxTypes';

/**
 * Everything the processor needs from the network, as an interface.
 *
 * The real implementation is `src/offline/httpTransport.ts`. Tests drive a
 * fake, which is what makes the two guarantees in ADR-0023 — the durable
 * in-flight marker and head-of-line blocking — assertable at all: both are
 * statements about the *order* of a store write and a network call.
 */
export interface OutboxTransport {
  sendTransition(item: OutboxItem, payload: TransitionPayload): Promise<void>;
  fetchTrip(tripId: number): Promise<Trip>;
  sendAvailabilityRequest(payload: AvailabilityRequestPayload): Promise<void>;
  listAvailabilityRequests(): Promise<AvailabilityBlock[]>;
  withdrawAvailabilityRequest(id: number): Promise<void>;
}

/**
 * What the server turned out to have done with an item whose outcome was
 * unknown. `unknown` means the reconciling read itself failed — the network is
 * still down — and is not an answer, so the item stays exactly as it was.
 */
type Reconciliation = 'applied' | 'not-applied' | 'conflict' | 'unknown';

export type DrainOutcome = {
  completed: number;
  parked: number;
  deferred: number;
  /** True when a 401 stopped the pass. The session layer re-authenticates. */
  paused: boolean;
};

export type OutboxProcessorOptions = {
  store: OutboxStore;
  transport: OutboxTransport;
  now?: () => number;
  /** Injected so backoff is deterministic under test. */
  random?: () => number;
  onUnauthenticated?: () => void;
  /**
   * `code` is the reason the item was *just* parked, which is not on the item
   * handed alongside it: that is the row as it was read at the start of the
   * pass, so its `lastErrorCode` belongs to a previous attempt and is null on
   * the first. A caller that reports the parking — `SyncProvider` does —
   * needs the code that caused it, not the one before it. Existing one-argument
   * callbacks are unaffected.
   */
  onParked?: (item: OutboxItem, code: string) => void;
};

/** Five seconds, doubling. Short enough to catch a connection flickering back. */
const BASE_BACKOFF_MS = 5_000;

/** Five minutes. Past this, waiting longer costs the driver and buys nothing. */
const MAX_BACKOFF_MS = 5 * 60_000;

export class OutboxProcessor {
  private readonly store: OutboxStore;
  private readonly transport: OutboxTransport;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly onUnauthenticated?: (() => void) | undefined;
  private readonly onParked?: ((item: OutboxItem, code: string) => void) | undefined;

  /** Set by a 401. Nothing drains until the session layer clears it. */
  private paused = false;
  private draining = false;

  constructor(options: OutboxProcessorOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.onUnauthenticated = options.onUnauthenticated;
    this.onParked = options.onParked;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Called after a successful re-authentication. */
  resume(): void {
    this.paused = false;
  }

  /**
   * Sends what it can, once.
   *
   * Re-entrancy is refused rather than queued. Two concurrent drains would
   * each read the same pending row and send it twice, which is the one thing
   * this class exists to prevent — and it is easy to provoke, because a
   * reconnect and a foreground event routinely land within a second of each
   * other.
   */
  async drain(): Promise<DrainOutcome> {
    // Refused before the span, and the order matters. A refused pass does no
    // work, and a reconnect and a foreground event routinely land within a
    // second of each other — traced, this would be the loudest and least
    // informative thing the app sends.
    if (this.paused || this.draining) {
      return { completed: 0, parked: 0, deferred: 0, paused: this.paused };
    }

    /*
     * Traced (ADR-0054 §4), and this is the one piece of work in the driver
     * app that nothing else could ever measure.
     *
     * A drain fires on a NetInfo change or an app-state change — from no
     * screen, often with the app in a pocket, sometimes with the process
     * cold-started into it. There is no navigation transaction to hang it
     * under, so `traced` makes it a transaction of its own. Everything
     * underneath it is already instrumented by the SDK: each `process()` call
     * is a `fetch`, and the waterfall shows which item took the time.
     *
     * What this is for, in one sentence: it is how a completed trip reaches
     * the office, and ADR-0023 §1 says losing one loses a contractual data
     * point. "The sync is slow upcountry" has been an anecdote for as long as
     * the app has existed.
     */
    return traced('outbox.drain', 'send what the driver did offline', async () => {
      const outcome = await this.drainOnce();

      annotate(outcome);

      return outcome;
    });
  }

  /**
   * The pass itself, with the re-entrancy flag it sets and clears.
   *
   * Split from {@see drain} only so the span above wraps work that is
   * actually going to happen — see the refusal there.
   */
  private async drainOnce(): Promise<DrainOutcome> {
    const outcome: DrainOutcome = { completed: 0, parked: 0, deferred: 0, paused: this.paused };

    this.draining = true;

    try {
      const items = await this.store.pending();

      // Streams that have hit something unresolved in this pass. ADR-0023 §5:
      // an item behind a stalled one must not overtake it, because its
      // `expectedFrom` was recorded against a state the stalled item is about
      // to change. Overtaking would make the reconciler park valid work.
      const blocked = new Set<string>();

      for (const item of items) {
        if (this.paused) {
          break;
        }

        if (blocked.has(item.streamKey)) {
          outcome.deferred += 1;
          continue;
        }

        if (item.nextAttemptAt > this.now()) {
          blocked.add(item.streamKey);
          outcome.deferred += 1;
          continue;
        }

        const result = await this.process(item);

        if (result === 'completed') {
          outcome.completed += 1;
          continue;
        }

        blocked.add(item.streamKey);

        if (result === 'parked') {
          outcome.parked += 1;
        } else {
          outcome.deferred += 1;
        }
      }
    } finally {
      this.draining = false;
    }

    outcome.paused = this.paused;

    return outcome;
  }

  private async process(item: OutboxItem): Promise<'completed' | 'parked' | 'deferred'> {
    // ADR-0023 §3. An item whose last attempt ended in the dark is never sent
    // blind. `waiting → trip_resumed → waiting` is a legal cycle, so a replay
    // the server would have refused on any other transition is here accepted,
    // pausing the trip a second time and putting a second row in the timeline
    // that waiting-time billing is computed from.
    if (item.inflightAt !== null) {
      const verdict = await this.reconcile(item);

      if (verdict === 'applied') {
        await this.store.complete(item.id);

        return 'completed';
      }

      if (verdict === 'conflict') {
        return this.park(item, 'OUTBOX_CONFLICT', conflictMessage(item));
      }

      if (verdict === 'unknown') {
        // The reconciling read counts as an attempt. Without this the backoff
        // would sit flat at its floor for as long as the device is offline,
        // and every phone in the depot would keep hammering the same failing
        // endpoint every few seconds.
        await this.store.markInflight(item.id, this.now());
        await this.deferWithBackoff(item, 'OFFLINE', 'Waiting for a connection.');

        return 'deferred';
      }
    }

    // Committed before the request, not after. An app killed on the next line
    // restarts holding a row that says "outcome unknown", which is the truth;
    // without this write it would restart holding a row that says "untried"
    // and re-send it.
    await this.store.markInflight(item.id, this.now());

    try {
      await this.send(item);
      await this.store.complete(item.id);

      return 'completed';
    } catch (error) {
      return this.classify(item, error);
    }
  }

  private async send(item: OutboxItem): Promise<void> {
    if (item.kind === 'trip_transition') {
      return this.transport.sendTransition(item, item.payload as TransitionPayload);
    }

    if (item.kind === 'availability_request') {
      return this.transport.sendAvailabilityRequest(item.payload as AvailabilityRequestPayload);
    }

    return this.transport.withdrawAvailabilityRequest(
      (item.payload as AvailabilityWithdrawPayload).id,
    );
  }

  /**
   * Decides an item's fate from the failure's `code` — never its message
   * (AGENTS.md API Standards).
   */
  private async classify(
    item: OutboxItem,
    error: unknown,
  ): Promise<'completed' | 'parked' | 'deferred'> {
    // The outcome is genuinely unknown: leave the in-flight marker set so the
    // next attempt reconciles instead of replaying.
    if (isOutcomeUnknown(error)) {
      await this.deferWithBackoff(item, 'OFFLINE', 'Waiting for a connection.');

      return 'deferred';
    }

    // Past here the server answered, so *this* attempt applied nothing. The
    // in-flight marker is cleared per branch rather than here, because one
    // branch below still needs it: a 409 whose reconciliation could not
    // reach the server has learned nothing, and must stay reconcile-first.
    if (!isApiError(error)) {
      return this.park(item, 'UNEXPECTED', 'This could not be sent. Show this to the office.');
    }

    switch (error.code) {
      // A 409 is a question, not an answer: it means either "my own earlier
      // attempt already won" or "this is genuinely illegal now", and only the
      // trip's current status can tell those apart (ADR-0023 §4).
      case 'INVALID_TRIP_TRANSITION': {
        const verdict = await this.reconcile(item);

        if (verdict === 'applied') {
          await this.store.complete(item.id);

          return 'completed';
        }

        // The reconciling read failed too. Keep the marker so the next pass
        // asks again before sending — the 409 proved this attempt did nothing,
        // but not that an earlier one didn't.
        if (verdict === 'unknown') {
          await this.deferWithBackoff(item, error.code, error.message);

          return 'deferred';
        }

        return this.park(item, error.code, conflictMessage(item));
      }

      // Signing in again must not be a data-loss event: the token lasts 24
      // hours (ADR-0008) with no refresh, so a driver on a long shift meets
      // this mid-queue. Pause, keep everything, do not count the attempt.
      case 'UNAUTHENTICATED':
        await this.store.clearInflight(item.id);
        this.paused = true;
        this.onUnauthenticated?.();

        return 'deferred';

      // ADR-0022 is explicit that this is a conversation, not a workaround.
      // Parked and left visible rather than retried into a wall.
      case 'TOKEN_SCOPE_EXCEEDED':
        return this.park(
          item,
          error.code,
          'This app is not permitted to do that. Please report it to the office.',
        );

      case 'THROTTLED':
        await this.store.clearInflight(item.id);
        await this.deferWithBackoff(item, error.code, error.message, error.retryAfterSeconds);

        return 'deferred';

      // Everything else the server answered definitively: 422 on a payload
      // that will never become valid, 403, 404, an already-answered leave
      // request. Parked, with the payload intact.
      default:
        return this.park(item, error.code, error.message);
    }
  }

  /**
   * Asks the server what it actually did.
   *
   * Compares against both the target and the state the item was queued
   * against, because "my write landed" and "nothing landed" are not the only
   * two possibilities — the trip may have moved somewhere this item never
   * anticipated, and that needs a person rather than a retry.
   */
  private async reconcile(item: OutboxItem): Promise<Reconciliation> {
    try {
      if (item.kind === 'trip_transition' && item.tripId !== null) {
        const trip = await this.transport.fetchTrip(item.tripId);

        if (trip.status === item.targetStatus) {
          return 'applied';
        }

        return trip.status === item.expectedFrom ? 'not-applied' : 'conflict';
      }

      if (item.kind === 'availability_request') {
        return this.reconcileAvailabilityRequest(item.payload as AvailabilityRequestPayload);
      }

      if (item.kind === 'availability_withdraw') {
        return this.reconcileWithdrawal((item.payload as AvailabilityWithdrawPayload).id);
      }
    } catch (error) {
      // A 404 on the trip is an answer, not an outage: it is gone, or it was
      // never this driver's (the API returns 404 rather than 403 across a
      // tenant boundary — AGENTS.md). Either way no retry will help.
      if (isApiError(error) && !isOutcomeUnknown(error)) {
        return 'conflict';
      }

      return 'unknown';
    }

    return 'unknown';
  }

  /**
   * Matches on what the driver typed, because the endpoint offers nothing
   * better: `POST /me/availability-requests` takes no client key and leaves
   * behind no state machine to interrogate.
   *
   * ADR-0023 §8 records this as the heuristic it is. Its failure mode is a
   * duplicate row in the office's queue, which a human declines; that is a
   * different order of problem from a duplicated odometer reading, and it does
   * not warrant the machinery the transitions get.
   */
  private async reconcileAvailabilityRequest(
    payload: AvailabilityRequestPayload,
  ): Promise<Reconciliation> {
    const existing = await this.transport.listAvailabilityRequests();

    const match = existing.find(
      (block) =>
        block.kind === payload.kind &&
        block.reason === payload.reason &&
        sameInstant(block.starts_at, payload.starts_at),
    );

    return match ? 'applied' : 'not-applied';
  }

  private async reconcileWithdrawal(id: number): Promise<Reconciliation> {
    const existing = await this.transport.listAvailabilityRequests();
    const match = existing.find((block) => block.id === id);

    if (!match) {
      return 'applied';
    }

    // Still there and no longer unanswered: the office decided while the
    // withdrawal was in flight, and the server would refuse it now with
    // AVAILABILITY_ALREADY_ANSWERED (ADR-0017 §6).
    return match.status === 'requested' ? 'not-applied' : 'conflict';
  }

  private async park(
    item: OutboxItem,
    code: string,
    message: string,
  ): Promise<'parked'> {
    await this.store.park(item.id, code, message);
    this.onParked?.(item, code);

    return 'parked';
  }

  private async deferWithBackoff(
    item: OutboxItem,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ): Promise<void> {
    const delay =
      retryAfterSeconds !== null
        ? retryAfterSeconds * 1000
        : backoffMs(item.attempts, this.random());

    await this.store.reschedule(item.id, this.now() + delay, code, message);
  }
}

/**
 * Exponential with jitter.
 *
 * `attemptsAlreadyMade` is the count *before* the attempt that just failed —
 * the value read out of the store at the start of the pass — so the first
 * failure waits the base delay and each subsequent one doubles.
 *
 * The jitter is not decoration: every driver in a depot regains coverage at
 * the same moment when a mast comes back, and without it they all retry in
 * the same second.
 */
export function backoffMs(attemptsAlreadyMade: number, jitter: number): number {
  const ceiling = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.max(0, attemptsAlreadyMade),
  );

  return Math.round(ceiling * (0.5 + jitter * 0.5));
}

function conflictMessage(item: OutboxItem): string {
  if (item.kind === 'trip_transition') {
    return 'This trip has moved on since you tapped. Check the trip and try again.';
  }

  return 'The office has already answered this request.';
}

/**
 * Timestamps round-trip through the server's serialiser, so the string the app
 * sent and the string it reads back are the same instant in different formats.
 * Comparing them as text would fail to match a request that was in fact
 * created, and the app would submit it a second time.
 */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return Date.parse(a) === Date.parse(b);
}
