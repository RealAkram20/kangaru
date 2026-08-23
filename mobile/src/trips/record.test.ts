import type { DriverLedgerEntry, Trip, TripEvent } from '../api/types';
import {
  cashNote,
  distanceLabel,
  minutesLabel,
  railAnnouncement,
  recordDate,
  recordIdentifier,
  recordMoney,
  recordRows,
  waitingMinutesFrom,
} from './record';

/**
 * The trip record's figures and its rail.
 *
 * The cases here are the four things the mockup for this screen asked for that
 * had to be answered honestly instead:
 *
 * 1. **The rail is the timeline, not stops.** There are no stops in this
 *    platform, so every row has to come from a transition that happened.
 * 2. **A trip that did not complete still renders.** This screen owns
 *    `cancelled`, `no_show`, `rejected` and the unanswered `assigned` — the
 *    mockup drew only the happy path.
 * 3. **A delivery is not a ride.** One screen, both jobs, and the wording has
 *    to follow the service.
 * 4. **The money is credits and debts, told apart by sign** — never by a list of
 *    kinds this app would then own a copy of.
 */

const NOW = Date.parse('2026-08-15T09:30:00Z');

function event(partial: Partial<TripEvent> = {}): TripEvent {
  return {
    id: 1,
    trip_id: 7,
    from_status: null,
    to_status: 'assigned',
    user_id: 3,
    notes: null,
    created_at: '2026-08-15T05:30:00Z',
    local_day: '2026-08-15',
    local_time: '08:30',
    ...partial,
  };
}

function trip(partial: Partial<Trip> = {}): Trip {
  return {
    id: 7,
    tenant_id: null,
    customer_id: 4,
    booking_id: null,
    vehicle_id: 2,
    driver_id: 3,
    origin: 'Acacia Mall',
    destination: 'Kololo Hill Drive',
    pickup: { label: 'Acacia Mall', latitude: null, longitude: null },
    dropoff: { label: 'Kololo Hill Drive', latitude: null, longitude: null },
    service_type: 'ride',
    reference: 'KR-2026-0815',
    package: null,
    status: 'trip_completed',
    allowed_transitions: [],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 500,
  variance_threshold_percent: 10,
  provisional_fare: null,
  distance: null,
    odometer_start: 10_000,
    odometer_end: 10_013,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    // Strings, because `decimal(8,2)` arrives as one — no float ever touches
    // the figure an odometer reading is reconciled against.
    distance_km: '12.60',
    gps_distance_km: '12.40',
    distance_variance_flagged: false,
    unplanned_stop_count: 0,
    started_at: '2026-08-15T05:35:00Z',
    completed_at: '2026-08-15T06:22:00Z',
    duration_minutes: 32,
    fare: null,
    estimated_fare: null,
    payment: { payment_method: 'cash', payer: null },
    earnings: null,
    passenger_contact: null,
    created_at: '2026-08-15T05:20:00Z',
    updated_at: null,
    ...partial,
  };
}

function entry(partial: Partial<DriverLedgerEntry> = {}): DriverLedgerEntry {
  return {
    id: 1,
    kind: 'fare_earned',
    kind_label: 'Fare earned',
    amount_minor: 10_000,
    currency: 'UGX',
    description: 'Ride earnings at 20% commission',
    trip_id: 7,
    service_type: 'ride',
    created_at: '2026-08-15T06:30:00Z',
    ...partial,
  };
}

// -- The rail ---------------------------------------------------------------

it('builds the rail from the transitions that actually happened', () => {
  const rows = recordRows(
    trip(),
    [
      event({ id: 1, to_status: 'accepted', local_time: '08:20' }),
      event({ id: 2, to_status: 'driver_arrived', local_time: '08:30' }),
      event({ id: 3, to_status: 'passenger_onboard', local_time: '08:33' }),
      event({ id: 4, to_status: 'trip_started', local_time: '08:35' }),
      event({ id: 5, to_status: 'trip_completed', local_time: '09:22' }),
    ],
    NOW,
  );

  expect(rows.map((row) => row.kind)).toEqual(['pickup', 'collected', 'dropoff']);
  // Timed from `driver_arrived` — the moment the driver was at the place, not
  // the moment they agreed to go there.
  expect(rows[0]!.time).toBe('08:30 AM');
  expect(rows[0]!.place).toBe('Acacia Mall');
  expect(rows[0]!.pill).toBe('Completed');
  expect(rows[2]!.time).toBe('09:22 AM');
});

it('renders a place with no timeline row as not reached, never as a time', () => {
  // The unanswered corporate assignment this screen also owns: `assigned`, one
  // event, nothing else has happened. Two places and no times is the honest
  // picture, and `docs/screen-rules.md` §1 forbids filling them with anything.
  const rows = recordRows(trip({ status: 'assigned' }), [event({ to_status: 'assigned' })], NOW);

  expect(rows.map((row) => row.kind)).toEqual(['pickup', 'dropoff']);
  expect(rows.every((row) => row.time === null)).toBe(true);
  expect(rows.every((row) => row.pill === 'Not reached')).toBe(true);
});

it('words the collection row by the service, because one screen serves both', () => {
  const rows = recordRows(
    trip({ service_type: 'delivery' }),
    [event({ to_status: 'passenger_onboard' })],
    NOW,
  );

  expect(rows.find((row) => row.kind === 'collected')?.label).toBe('Parcel collected');

  const ride = recordRows(trip(), [event({ to_status: 'passenger_onboard' })], NOW);

  expect(ride.find((row) => row.kind === 'collected')?.label).toBe('Passenger aboard');
});

it('draws one waiting row per pause, with the minutes billing would count', () => {
  const rows = recordRows(
    trip(),
    [
      event({ id: 1, to_status: 'trip_started', created_at: '2026-08-15T05:35:00Z' }),
      event({
        id: 2,
        to_status: 'waiting',
        created_at: '2026-08-15T05:45:00Z',
        local_time: '08:45',
      }),
      event({
        id: 3,
        to_status: 'trip_resumed',
        created_at: '2026-08-15T05:52:30Z',
        local_time: '08:52',
      }),
      event({ id: 4, to_status: 'trip_completed', created_at: '2026-08-15T06:22:00Z' }),
    ],
    NOW,
  );

  const waiting = rows.find((row) => row.kind === 'waiting');

  expect(waiting?.span).toBe('08:45 AM – 08:52 AM');
  // Seven and a half minutes floors to seven. `WaitingTimeCalculator` truncates
  // to whole minutes, and rounding up here would show a driver a minute the
  // invoice does not have.
  expect(waiting?.pill).toBe('7 min');
  expect(waiting?.tone).toBe('warning');
});

it('closes a waiting period on the next transition, whatever it is', () => {
  // Not specifically on `trip_resumed`. That is the only exit the graph allows
  // today, and assuming it would run a period on forever the day another is
  // added — the mutation that survived a test in `progress.ts` once already.
  const rows = recordRows(
    trip(),
    [
      event({ id: 1, to_status: 'waiting', created_at: '2026-08-15T05:45:00Z' }),
      event({
        id: 2,
        to_status: 'trip_completed',
        created_at: '2026-08-15T05:50:00Z',
        local_time: '08:50',
      }),
    ],
    NOW,
  );

  expect(rows.find((row) => row.kind === 'waiting')?.pill).toBe('5 min');
});

it('counts a pause that is still open against now, and says it is running', () => {
  const rows = recordRows(
    trip({ status: 'waiting' }),
    [event({ id: 1, to_status: 'waiting', created_at: '2026-08-15T09:18:00Z' })],
    NOW,
  );

  const waiting = rows.find((row) => row.kind === 'waiting');

  expect(waiting?.label).toBe('Waiting now');
  expect(waiting?.pill).toBe('12 min');
  expect(waiting?.span).toContain('– now');
});

it('names how a trip ended when it did not end at the drop-off', () => {
  const rows = recordRows(
    trip({ status: 'cancelled' }),
    [
      event({ id: 1, to_status: 'accepted', local_time: '08:20' }),
      event({ id: 2, to_status: 'cancelled', local_time: '08:28' }),
    ],
    NOW,
  );

  const ended = rows.find((row) => row.kind === 'ended');

  expect(ended?.time).toBe('08:28 AM');
  expect(ended?.tone).toBe('danger');
  // And the drop-off is honest about never having happened.
  expect(rows.find((row) => row.kind === 'dropoff')?.pill).toBe('Not reached');
});

it('says a whole rail row in one sentence', () => {
  // `docs/screen-rules.md` §6. Four fragments — "Pickup", "08:30 AM", "Acacia
  // Mall", "Completed" — is what a rail linearises into if nothing composes it,
  // and a driver listening needs one statement about one moment.
  const rows = recordRows(trip(), [event({ to_status: 'driver_arrived', local_time: '08:30' })], NOW);

  // The label and its moment are one clause: "Pickup. at 08:30 AM." is what a
  // naive join gives and it reads as a fault.
  expect(railAnnouncement(rows[0]!)).toBe('Pickup at 08:30 AM. Acacia Mall. Completed.');

  const waiting = recordRows(
    trip(),
    [
      event({ id: 1, to_status: 'waiting', created_at: '2026-08-15T05:45:00Z', local_time: '08:45' }),
      event({ id: 2, to_status: 'trip_resumed', created_at: '2026-08-15T05:52:00Z', local_time: '08:52' }),
    ],
    NOW,
  ).find((row) => row.kind === 'waiting');

  expect(railAnnouncement(waiting!)).toBe('Waiting, 08:45 AM – 08:52 AM. 7 min.');

  // The pill is not repeated when it is already the label: "Cancelled.
  // Cancelled." is how a reader teaches somebody to stop listening.
  const cancelled = recordRows(
    trip({ status: 'cancelled' }),
    [event({ to_status: 'cancelled', local_time: '08:28' })],
    NOW,
  );

  expect(railAnnouncement(cancelled[cancelled.length - 1]!)).toBe('Cancelled at 08:28 AM.');
});

// -- The date and the identifier -------------------------------------------

it('takes the date from the server\'s fleet-zone day, not from the handset', () => {
  // `created_at` is UTC. A phone deriving the day from it rolls at 03:00 local,
  // which files an evening trip under the previous day — plausibly enough that
  // nobody reports it.
  expect(recordDate([event({ local_day: '2026-08-15' })])).toBe('15 Aug 2026');
  expect(recordDate([event({ local_day: null })])).toBeNull();
  expect(recordDate(undefined)).toBeNull();
  // A value it cannot parse falls through rather than becoming a made-up date.
  expect(recordDate([event({ local_day: 'not a day' })])).toBe('not a day');
});

it('quotes the customer\'s reference, and says so when it only has a trip number', () => {
  expect(recordIdentifier(trip())).toEqual({
    value: 'KR-2026-0815',
    label: 'Booking reference',
  });

  // A corporate trip has a booking rather than an order request, so there is no
  // reference at all. Showing a bare number would have the driver and the
  // office quoting different strings at each other.
  expect(recordIdentifier(trip({ reference: null }))).toEqual({
    value: '#7',
    label: 'Trip number',
  });
});

// -- The money -------------------------------------------------------------

it('tells earnings from cash held by the sign, never by the kind', () => {
  // ADR-0029 §2 makes the sign the meaning. A list of "earning kinds" here
  // would be this app holding a copy of a server rule, and would be wrong the
  // day a kind is added.
  const money = recordMoney([
    entry({ id: 1, kind: 'fare_earned', amount_minor: 10_000 }),
    entry({ id: 2, kind: 'cash_collected', amount_minor: -12_500 }),
    entry({ id: 3, kind: 'tip_earned', amount_minor: 1_600 }),
    entry({ id: 4, kind: 'tip_cash_collected', amount_minor: -2_000 }),
  ]);

  expect(money.earnedMinor).toBe(11_600);
  expect(money.cashHeldMinor).toBe(14_500);
  expect(money.currency).toBe('UGX');
});

it('counts a kind it has never seen as earnings when the sign says so', () => {
  // The property the sign test buys: a credit added next quarter is counted
  // correctly by a build that has never heard of it.
  const money = recordMoney([entry({ kind: 'bonus', amount_minor: 20_000 })]);

  expect(money.earnedMinor).toBe(20_000);
  expect(money.cashHeldMinor).toBe(0);
});

it('never sums the pair into one figure', () => {
  // Summing a cash ride's two rows reports it as roughly *minus the
  // commission* — the trap `Modules/Drivers/README.md` records, on the screen
  // where a driver is looking straight at the cash in question.
  const money = recordMoney([
    entry({ id: 1, kind: 'fare_earned', amount_minor: 10_000 }),
    entry({ id: 2, kind: 'cash_collected', amount_minor: -12_500 }),
  ]);

  expect(money.earnedMinor).toBe(10_000);
  expect(money.earnedMinor - money.cashHeldMinor).toBe(-2_500);
});

it('has no currency and no figures for a trip the ledger has not touched', () => {
  expect(recordMoney([])).toEqual({ earnedMinor: 0, cashHeldMinor: 0, currency: null });
});

it('says nothing about cash when none was held', () => {
  expect(cashNote(0, 'UGX 0')).toBeNull();
  expect(cashNote(12_500, 'UGX 12,500')).toContain('UGX 12,500');
});

// -- Waiting: zero and "never applied" are different answers ---------------

it('reports zero waiting on a journey that ran and never paused', () => {
  // A fact, and it should say so: this trip started, finished, and stopped
  // nowhere in between.
  const minutes = waitingMinutesFrom(
    trip(),
    [event({ to_status: 'trip_started' }), event({ id: 2, to_status: 'trip_completed' })],
    NOW,
  );

  expect(minutes).toBe(0);
});

it('reports no waiting figure at all for a trip that never started', () => {
  // **Found by a screen test showing "0 min" on a cancelled trip.** Billable
  // waiting begins inside a journey — `WaitingTimeCalculator` opens a period on
  // a transition into `waiting`, which is unreachable before `trip_started` — so
  // a zero here is a statement about time that never existed.
  const minutes = waitingMinutesFrom(
    trip({ status: 'cancelled', started_at: null }),
    [event({ to_status: 'cancelled' })],
    NOW,
  );

  expect(minutes).toBeNull();
  expect(minutesLabel(minutes)).toBe('—');
});

it('reports no waiting figure while the timeline is still in flight', () => {
  // The timeline arrives in a second request. A zero drawn in that window is
  // replaced by a real figure a moment later, which is worse than a dash that
  // fills in.
  expect(waitingMinutesFrom(trip(), undefined, NOW)).toBeNull();
});

it('falls back to `started_at` when the timeline has not caught up', () => {
  // Same order and same reasoning as `progress.ts::startedAtFrom`: the column is
  // a legitimate source for a figure that bills nothing, and it is never a
  // request behind.
  expect(waitingMinutesFrom(trip({ started_at: '2026-08-15T05:35:00Z' }), [], NOW)).toBe(0);
});

// -- The em dashes ---------------------------------------------------------

it('renders an em dash for every figure the platform does not have', () => {
  // Never `0 min` and never `0.0 km`. A zero on a trip somebody drove is a
  // claim; the dash is the truth.
  expect(minutesLabel(null)).toBe('—');
  expect(minutesLabel(0)).toBe('0 min');
  expect(distanceLabel(null)).toBe('—');
  // `decimal(8,2)` arrives as a string. Passing it through would print
  // "12.60 km"; `Number()` alone would print "13" for "13.00", so the same
  // screen would show a different precision on every other trip.
  expect(distanceLabel('12.60')).toBe('12.6 km');
  expect(distanceLabel('13.00')).toBe('13.0 km');
  expect(distanceLabel('not a distance')).toBe('—');
});
