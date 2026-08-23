import { ApiError, NetworkError } from '../api/errors';
import type { AvailabilityBlock, Trip, TripStatus } from '../api/types';
import { MemoryOutboxStore } from './memoryOutboxStore';
import { backoffMs, OutboxProcessor, type OutboxTransport } from './outbox';
import type { NewOutboxItem, OutboxItem } from './outboxTypes';

/**
 * The offline queue, tested against the failures it exists for.
 *
 * The three that matter, and which every assertion here is ultimately about:
 *
 * 1. A trip completion captured in a dead zone reaches the server exactly
 *    once, even though the app was killed while the request was in flight.
 * 2. `waiting ⇄ trip_resumed` is the one legal cycle in the lifecycle, so it
 *    is the one place a blind replay is *accepted* rather than refused. It
 *    must not be replayed blind.
 * 3. Nothing the driver typed is ever discarded because a request failed.
 */

const KAMPALA_TRIP: Trip = {
  id: 42,
  tenant_id: 1,
  customer_id: null,
  booking_id: 7,
  vehicle_id: 3,
  driver_id: 9,
  origin: 'Kampala Road',
  destination: 'Entebbe',
  pickup: { label: 'Kampala', latitude: null, longitude: null },
  dropoff: { label: 'Entebbe', latitude: null, longitude: null },
  service_type: null,
  reference: null,
  package: null,
  fare: null,
  estimated_fare: null,
  earnings: null,
  status: 'trip_started',
  allowed_transitions: ['waiting', 'trip_completed'],
  pickup_wait_target_seconds: 300,
  odometer_max_km_per_trip: 2000,
  variance_threshold_percent: 10,
  provisional_fare: null,
  distance: null,
  payment: null,

  odometer_start: 104_320,
  odometer_end: null,
  odometer_start_photo_url: null,
  odometer_end_photo_url: null,
  distance_km: null,
  gps_distance_km: null,
  distance_variance_flagged: null,
  unplanned_stop_count: 0,
  started_at: '2026-08-07T08:00:00Z',
  completed_at: null,
  duration_minutes: null,
  passenger_contact: null,
  created_at: '2026-08-07T07:30:00Z',
  updated_at: '2026-08-07T08:00:00Z',
};

function tripAt(status: TripStatus): Trip {
  return { ...KAMPALA_TRIP, status };
}

function completionItem(overrides: Partial<NewOutboxItem> = {}): NewOutboxItem {
  return {
    id: 'item-complete',
    kind: 'trip_transition',
    streamKey: 'trip:42',
    tripId: 42,
    expectedFrom: 'trip_started',
    targetStatus: 'trip_completed',
    photoUri: null,
    payload: { to: 'trip_completed', odometer_end: 104_468 },
    ...overrides,
  };
}

/**
 * The single pending row, asserted to exist.
 *
 * Never `(await store.pending())[0]?.field`. Optional chaining on an empty
 * array yields `undefined`, and `expect(undefined).not.toBeNull()` passes —
 * so a mutation that parks the item instead of deferring it would slip
 * through green. This turned up under exactly that mutation while writing
 * these tests, which is the argument for running them.
 */
async function onlyPendingItem(store: MemoryOutboxStore): Promise<OutboxItem> {
  const pending = await store.pending();

  expect(pending).toHaveLength(1);

  return pending[0] as OutboxItem;
}

/**
 * A transport that records every call, so tests can assert on what the app
 * actually put on the wire — the only thing the server ever sees.
 */
class FakeTransport implements OutboxTransport {
  readonly sentTransitions: OutboxItem[] = [];
  readonly fetchedTrips: number[] = [];
  readonly sentAvailability: unknown[] = [];
  readonly withdrawn: number[] = [];

  /** Queued outcomes for `sendTransition`; a plain resolve when exhausted. */
  transitionOutcomes: (Error | null)[] = [];
  tripState: Trip = KAMPALA_TRIP;
  tripFetchError: Error | null = null;
  availabilityBlocks: AvailabilityBlock[] = [];

  async sendTransition(item: OutboxItem): Promise<void> {
    this.sentTransitions.push(item);

    const outcome = this.transitionOutcomes.shift();

    if (outcome) {
      throw outcome;
    }
  }

  async fetchTrip(tripId: number): Promise<Trip> {
    this.fetchedTrips.push(tripId);

    if (this.tripFetchError) {
      throw this.tripFetchError;
    }

    return this.tripState;
  }

  async sendAvailabilityRequest(payload: unknown): Promise<void> {
    this.sentAvailability.push(payload);
  }

  async listAvailabilityRequests(): Promise<AvailabilityBlock[]> {
    return this.availabilityBlocks;
  }

  async withdrawAvailabilityRequest(id: number): Promise<void> {
    this.withdrawn.push(id);
  }
}

function buildProcessor(store: MemoryOutboxStore, transport: FakeTransport, now = 1_000) {
  return new OutboxProcessor({
    store,
    transport,
    now: () => now,
    // Deterministic backoff. Real jitter is asserted separately, on the pure
    // function, so no test here depends on a random number.
    random: () => 0,
  });
}

describe('OutboxProcessor — the happy path', () => {
  it('sends a queued completion and removes it from the queue', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    const outcome = await buildProcessor(store, transport).drain();

    expect(outcome.completed).toBe(1);
    expect(transport.sentTransitions).toHaveLength(1);
    expect(await store.all()).toHaveLength(0);
  });
});

describe('OutboxProcessor — an app killed mid-request', () => {
  /**
   * The guard: `markInflight` is committed *before* the request goes out.
   *
   * Mutation check — move the `markInflight` call in `process()` to after the
   * `send`, or delete it, and this fails: the restarted processor finds a row
   * that looks untried and sends the completion a second time.
   */
  it('marks the item in flight before the request leaves', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    const order: string[] = [];
    const originalMark = store.markInflight.bind(store);
    jest.spyOn(store, 'markInflight').mockImplementation(async (id, at) => {
      order.push('markInflight');

      return originalMark(id, at);
    });
    jest.spyOn(transport, 'sendTransition').mockImplementation(async () => {
      order.push('send');
    });

    await buildProcessor(store, transport).drain();

    expect(order).toEqual(['markInflight', 'send']);
  });

  it('reconciles instead of resending when the process died in flight', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    // The request reaches the server, is applied, and the app is killed
    // before the response lands.
    transport.transitionOutcomes = [new NetworkError('socket closed')];
    await buildProcessor(store, transport).drain();

    expect(transport.sentTransitions).toHaveLength(1);
    expect((await onlyPendingItem(store)).inflightAt).not.toBeNull();

    // Restart: a brand-new processor over the surviving rows, and the server
    // is now at the target because the lost request did land.
    transport.tripState = tripAt('trip_completed');
    const outcome = await buildProcessor(store, transport, 10_000_000).drain();

    expect(transport.fetchedTrips).toEqual([42]);
    expect(transport.sentTransitions).toHaveLength(1); // still one — not resent
    expect(outcome.completed).toBe(1);
    expect(await store.all()).toHaveLength(0);
  });

  it('does resend when the reconciling read proves nothing landed', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [new NetworkError('socket closed')];
    await buildProcessor(store, transport).drain();

    // Server is still where the driver left it: the write never arrived.
    transport.tripState = tripAt('trip_started');
    await buildProcessor(store, transport, 10_000_000).drain();

    expect(transport.sentTransitions).toHaveLength(2);
    expect(await store.all()).toHaveLength(0);
  });

  it('keeps waiting when the reconciling read cannot reach the server either', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [new NetworkError('socket closed')];
    await buildProcessor(store, transport).drain();

    transport.tripFetchError = new NetworkError('still offline');
    const outcome = await buildProcessor(store, transport, 10_000_000).drain();

    expect(outcome.deferred).toBe(1);
    expect(transport.sentTransitions).toHaveLength(1);

    const row = await onlyPendingItem(store);
    expect(row.inflightAt).not.toBeNull();
  });
});

describe('OutboxProcessor — the waiting/resumed cycle', () => {
  /**
   * The cycle `trip_started → waiting → trip_resumed → waiting` is the only
   * place in the lifecycle where re-sending an already-applied transition is
   * *legal*. Everywhere else the server's own state machine refuses the
   * replay with a 409; here it would accept it, pause the trip a second time,
   * and put a second row in `trip_events` — the table waiting-time billing is
   * computed from.
   *
   * Mutation check — delete the `inflightAt !== null` branch in `process()`
   * and this fails on the resend count.
   */
  it('never re-pauses a trip whose pause already landed', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue({
      id: 'item-pause',
      kind: 'trip_transition',
      streamKey: 'trip:42',
      tripId: 42,
      expectedFrom: 'trip_started',
      targetStatus: 'waiting',
      photoUri: null,
      payload: { to: 'waiting' },
    });

    transport.transitionOutcomes = [new NetworkError('tunnel')];
    await buildProcessor(store, transport).drain();

    transport.tripState = tripAt('waiting');
    await buildProcessor(store, transport, 10_000_000).drain();

    expect(transport.sentTransitions).toHaveLength(1);
    expect(await store.all()).toHaveLength(0);
  });

  /**
   * Head-of-line blocking, the second half of the guarantee (ADR-0023 §5).
   *
   * A stalled `waiting` with a `trip_resumed` behind it: if the resume were
   * allowed to overtake, the server would reach `trip_resumed`, and the
   * stalled item's reconciliation would then find neither its target nor its
   * `expectedFrom` and park a pause the driver legitimately made.
   *
   * Mutation check — remove the `blocked.add(item.streamKey)` calls in
   * `drain()` and this fails: the resume is sent while the pause is unresolved.
   */
  it('holds later items behind an unresolved one on the same trip', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();

    await store.enqueue({
      id: 'item-pause',
      kind: 'trip_transition',
      streamKey: 'trip:42',
      tripId: 42,
      expectedFrom: 'trip_started',
      targetStatus: 'waiting',
      photoUri: null,
      payload: { to: 'waiting' },
    });
    await store.enqueue({
      id: 'item-resume',
      kind: 'trip_transition',
      streamKey: 'trip:42',
      tripId: 42,
      expectedFrom: 'waiting',
      targetStatus: 'trip_resumed',
      photoUri: null,
      payload: { to: 'trip_resumed' },
    });

    transport.transitionOutcomes = [new NetworkError('tunnel')];
    const outcome = await buildProcessor(store, transport).drain();

    expect(transport.sentTransitions.map((item) => item.id)).toEqual(['item-pause']);
    expect(outcome.deferred).toBe(2);
  });

  it('lets a different trip through while one trip is stalled', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();

    await store.enqueue(completionItem({ id: 'stalled', streamKey: 'trip:42', tripId: 42 }));
    await store.enqueue(
      completionItem({ id: 'other-trip', streamKey: 'trip:77', tripId: 77 }),
    );

    transport.transitionOutcomes = [new NetworkError('tunnel')];
    const outcome = await buildProcessor(store, transport).drain();

    expect(transport.sentTransitions.map((item) => item.id)).toEqual(['stalled', 'other-trip']);
    expect(outcome.completed).toBe(1);
  });
});

describe('OutboxProcessor — 409 INVALID_TRIP_TRANSITION', () => {
  const conflict = () =>
    new ApiError({
      code: 'INVALID_TRIP_TRANSITION',
      message: 'This trip cannot move to that status.',
      status: 409,
    });

  /**
   * Mutation check — make the 409 branch park unconditionally and this fails:
   * a completion the server had in fact recorded is shown to the driver as an
   * error they must resolve.
   */
  it('treats a 409 as success when the trip is already at the target', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [conflict()];
    transport.tripState = tripAt('trip_completed');

    const outcome = await buildProcessor(store, transport).drain();

    expect(outcome.completed).toBe(1);
    expect(await store.all()).toHaveLength(0);
  });

  /**
   * Mutation check — make the 409 branch complete unconditionally and this
   * fails: a genuine conflict is silently swallowed and the odometer reading
   * the driver typed disappears with it.
   */
  it('parks a 409 when the trip has moved somewhere unexpected', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [conflict()];
    transport.tripState = tripAt('cancelled');

    const outcome = await buildProcessor(store, transport).drain();

    expect(outcome.parked).toBe(1);

    const all = await store.all();
    expect(all).toHaveLength(1);
    const row = all[0] as OutboxItem;
    expect(row.state).toBe('parked');
    // The reading survives. This is the whole point of parking rather than
    // dropping: the number is a contractual acceptance criterion.
    expect((row.payload as { odometer_end: number }).odometer_end).toBe(104_468);
  });
});

describe('OutboxProcessor — classifying failures by code', () => {
  it('pauses the whole queue on 401 and keeps every item', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());
    await store.enqueue(completionItem({ id: 'second', streamKey: 'trip:77', tripId: 77 }));

    transport.transitionOutcomes = [
      new ApiError({ code: 'UNAUTHENTICATED', message: 'Unauthenticated.', status: 401 }),
    ];

    const processor = buildProcessor(store, transport);
    const outcome = await processor.drain();

    expect(outcome.paused).toBe(true);
    expect(processor.isPaused()).toBe(true);
    expect(await store.pending()).toHaveLength(2);
    // The second trip's item was never attempted — the pass stops dead.
    expect(transport.sentTransitions).toHaveLength(1);

    // And nothing drains until the session layer says so.
    await processor.drain();
    expect(transport.sentTransitions).toHaveLength(1);

    processor.resume();
    await processor.drain();
    expect(transport.sentTransitions.length).toBeGreaterThan(1);
  });

  it('parks a 422 rather than retrying a payload that will never be valid', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [
      new ApiError({
        code: 'VALIDATION_FAILED',
        message: 'The given data was invalid.',
        status: 422,
        errors: { odometer_end: ['Closing odometer reading cannot be less than the opening reading.'] },
      }),
    ];

    const outcome = await buildProcessor(store, transport).drain();

    expect(outcome.parked).toBe(1);
    const parked = await store.all();
    expect(parked).toHaveLength(1);
    expect((parked[0] as OutboxItem).lastErrorCode).toBe('VALIDATION_FAILED');
  });

  it('parks TOKEN_SCOPE_EXCEEDED instead of retrying into a wall', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [
      new ApiError({ code: 'TOKEN_SCOPE_EXCEEDED', message: 'Not permitted.', status: 403 }),
    ];

    await buildProcessor(store, transport).drain();

    const scoped = await store.all();
    expect(scoped).toHaveLength(1);
    expect((scoped[0] as OutboxItem).state).toBe('parked');
  });

  /**
   * A 5xx says nothing about whether the application server behind the proxy
   * processed the request. Mutation check — narrow `isOutcomeUnknown` to
   * NetworkError alone and this fails: the item loses its in-flight marker and
   * the next pass resends a completion that may already have been applied.
   */
  it('treats a 5xx as an unknown outcome, not a clean failure', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [
      new ApiError({ code: 'SERVER_ERROR', message: 'Server error.', status: 502 }),
    ];

    await buildProcessor(store, transport).drain();

    expect((await onlyPendingItem(store)).inflightAt).not.toBeNull();
  });

  it('honours Retry-After on a 429 rather than its own backoff', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue({
      id: 'leave',
      kind: 'availability_request',
      streamKey: 'availability',
      tripId: null,
      expectedFrom: null,
      targetStatus: null,
      photoUri: null,
      payload: { kind: 'leave', starts_at: '2026-08-14T00:00:00Z', ends_at: null, reason: 'Family funeral' },
    });

    jest.spyOn(transport, 'sendAvailabilityRequest').mockRejectedValueOnce(
      new ApiError({ code: 'THROTTLED', message: 'Too many requests.', status: 429, retryAfterSeconds: 45 }),
    );

    await buildProcessor(store, transport, 1_000).drain();

    expect((await onlyPendingItem(store)).nextAttemptAt).toBe(1_000 + 45_000);
  });

  it('does not attempt an item before its backoff has elapsed', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    transport.transitionOutcomes = [new NetworkError('offline')];
    await buildProcessor(store, transport, 1_000).drain();

    const deferredUntil = (await onlyPendingItem(store)).nextAttemptAt;
    expect(deferredUntil).toBeGreaterThan(1_000);

    await buildProcessor(store, transport, deferredUntil - 1).drain();
    expect(transport.sentTransitions).toHaveLength(1);
  });
});

describe('OutboxProcessor — leave requests', () => {
  it('does not resubmit a request the server already holds', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    const payload = {
      kind: 'leave' as const,
      starts_at: '2026-08-14T00:00:00Z',
      ends_at: null,
      reason: 'Family funeral in Mbarara',
    };

    await store.enqueue({
      id: 'leave',
      kind: 'availability_request',
      streamKey: 'availability',
      tripId: null,
      expectedFrom: null,
      targetStatus: null,
      photoUri: null,
      payload,
    });

    const send = jest
      .spyOn(transport, 'sendAvailabilityRequest')
      .mockRejectedValueOnce(new NetworkError('offline'));
    await buildProcessor(store, transport).drain();

    // It had in fact been created — the server echoes it back in a different
    // timestamp format, which is why the match is on the instant, not the text.
    transport.availabilityBlocks = [
      {
        id: 5,
        resource_type: 'driver',
        resource_id: 9,
        kind: 'leave',
        status: 'requested',
        answered_at: null,
        answer_note: null,
        starts_at: '2026-08-14T00:00:00.000000Z',
        ends_at: null,
        reason: 'Family funeral in Mbarara',
        created_at: null,
        updated_at: null,
      },
    ];

    const outcome = await buildProcessor(store, transport, 10_000_000).drain();

    expect(outcome.completed).toBe(1);
    // One attempt in total: the reconciliation found the request already
    // there and the item was retired without a second POST.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats a withdrawal of an already-gone request as done', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue({
      id: 'withdraw',
      kind: 'availability_withdraw',
      streamKey: 'availability',
      tripId: null,
      expectedFrom: null,
      targetStatus: null,
      photoUri: null,
      payload: { id: 5 },
    });

    const withdraw = jest
      .spyOn(transport, 'withdrawAvailabilityRequest')
      .mockRejectedValueOnce(new NetworkError('offline'));
    await buildProcessor(store, transport).drain();

    transport.availabilityBlocks = [];
    const outcome = await buildProcessor(store, transport, 10_000_000).drain();

    expect(outcome.completed).toBe(1);
    expect(withdraw).toHaveBeenCalledTimes(1);
  });
});

describe('OutboxProcessor — concurrency', () => {
  /**
   * A reconnect and a foreground event routinely land within a second of each
   * other, and both trigger a drain. Two overlapping passes would each read
   * the same pending row and send it twice.
   *
   * Mutation check — delete the `this.draining` guard and this fails.
   */
  it('refuses to run two drains at once', async () => {
    const store = new MemoryOutboxStore();
    const transport = new FakeTransport();
    await store.enqueue(completionItem());

    let release: (() => void) | undefined;
    jest.spyOn(transport, 'sendTransition').mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const processor = buildProcessor(store, transport);
    const first = processor.drain();
    await Promise.resolve();
    const second = await processor.drain();

    expect(second.completed).toBe(0);

    release?.();
    await first;
  });
});

describe('backoffMs', () => {
  /**
   * The argument is the number of attempts made *before* the one that just
   * failed, so a first failure waits the base delay and each one after it
   * doubles. Mutation check — an off-by-one here (`2 ** (n - 1)`) makes the
   * first two retries identical, and this fails on the second assertion.
   */
  it('grows exponentially and stops at the ceiling', () => {
    expect(backoffMs(0, 1)).toBe(5_000);
    expect(backoffMs(1, 1)).toBe(10_000);
    expect(backoffMs(2, 1)).toBe(20_000);
    expect(backoffMs(20, 1)).toBe(300_000);
  });

  /**
   * Every driver in a depot regains coverage the moment a mast comes back.
   * Without jitter they all retry in the same second.
   *
   * Mutation check — return the ceiling directly and this fails.
   */
  it('spreads retries across a window rather than firing them together', () => {
    expect(backoffMs(0, 0)).toBe(2_500);
    expect(backoffMs(0, 1)).toBe(5_000);
  });
});
