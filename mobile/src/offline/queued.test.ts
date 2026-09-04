import type { TripStatus } from '../api/types';
import type { OutboxItem, OutboxState } from './outboxTypes';
import { queuedStatuses } from './queued';

/**
 * The map every live-leg screen reads to know what the driver has already
 * asked for.
 *
 * This is the half the screen suites cannot prove: they mock `useSync`, so if
 * this function stopped building the map they would all still pass while every
 * real screen silently went back to re-offering a transition already in flight.
 */

let sequence = 0;

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  sequence += 1;

  return {
    id: `item-${sequence}`,
    kind: 'trip_transition',
    streamKey: `trip:${overrides.tripId ?? 42}`,
    payload: { to: 'waiting' },
    tripId: 42,
    expectedFrom: 'trip_started',
    targetStatus: 'waiting',
    photoUri: null,
    state: 'pending' as OutboxState,
    attempts: 0,
    inflightAt: null,
    nextAttemptAt: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: 0,
    sequence,
    ...overrides,
  };
}

beforeEach(() => {
  sequence = 0;
});

it('maps a trip to the status it has been asked to move to', () => {
  const queued = queuedStatuses([item({ tripId: 42, targetStatus: 'waiting' })]);

  expect(queued.get(42)).toBe('waiting');
  expect(queued.size).toBe(1);
});

it('takes the last intent, not the first, when a trip carries two', () => {
  // A pause and a resume in one dead zone. They drain in order, so the trip
  // arrives at `trip_resumed` — showing the driver "paused" because that item
  // happens to be first in the queue would be showing them a state the trip
  // only passes through.
  const queued = queuedStatuses([
    item({ tripId: 42, targetStatus: 'waiting' }),
    item({ tripId: 42, targetStatus: 'trip_resumed' }),
  ]);

  expect(queued.get(42)).toBe('trip_resumed');
  expect(queued.size).toBe(1);
});

it('ignores a parked item, so a refused transition stops being claimed', () => {
  // The property that keeps this from lying. A parked item is one the server
  // refused; leaving it in the map would strand the screen claiming a state the
  // trip never reached, with no control to escape it.
  const queued = queuedStatuses([
    item({ tripId: 42, targetStatus: 'waiting', state: 'parked' }),
  ]);

  expect(queued.size).toBe(0);
});

it('keeps a trip whose other item parked', () => {
  const queued = queuedStatuses([
    item({ tripId: 42, targetStatus: 'waiting', state: 'parked' }),
    item({ tripId: 7, targetStatus: 'driver_arrived' }),
  ]);

  expect(queued.get(7)).toBe('driver_arrived');
  expect(queued.has(42)).toBe(false);
});

it('skips items that are not about a trip', () => {
  // A leave request carries no trip and no target status. Both are legitimately
  // null on the shared item shape, and defaulting either would put a nonsense
  // key in a map that live-leg screens route on.
  const queued = queuedStatuses([
    item({ kind: 'availability_request', tripId: null, targetStatus: null }),
    item({ tripId: 42, targetStatus: 'trip_started' }),
  ]);

  expect(queued.size).toBe(1);
  expect(queued.get(42)).toBe('trip_started');
});

it('keeps trips separate', () => {
  const queued = queuedStatuses([
    item({ tripId: 42, targetStatus: 'waiting' }),
    item({ tripId: 7, targetStatus: 'driver_en_route' as TripStatus }),
  ]);

  expect(queued.size).toBe(2);
  expect(queued.get(42)).toBe('waiting');
  expect(queued.get(7)).toBe('driver_en_route');
});

it('is empty when nothing is in flight', () => {
  expect(queuedStatuses([]).size).toBe(0);
});
