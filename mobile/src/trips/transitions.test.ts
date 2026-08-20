import type { Trip, TripStatus } from '../api/types';
import {
  activeTripRoute,
  driverActions,
  isInProgress,
  isLiveLeg,
  isPickupPhase,
  isTripInProgress,
  isWaitingForPassenger,
  shouldStreamGps,
  streamingTripId,
  tripDestination,
} from './transitions';

function tripWith(status: TripStatus, allowed: TripStatus[]): Trip {
  return {
    id: 1,
    tenant_id: 1,
    customer_id: null,
    booking_id: null,
    vehicle_id: 1,
    driver_id: 1,
    origin: 'Nakawa',
    destination: 'Jinja',
    pickup: { label: 'Kampala', latitude: null, longitude: null },
    dropoff: { label: 'Jinja', latitude: null, longitude: null },
    service_type: null,
    reference: null,
    package: null,
    fare: null,
    estimated_fare: null,
    earnings: null,
    status,
    allowed_transitions: allowed,
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 2000,
    payment: null,

    odometer_start: null,
    odometer_end: null,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: null,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
    passenger_contact: null,
    created_at: null,
    updated_at: null,
  };
}

describe('driverActions', () => {
  /**
   * The app holds no copy of the lifecycle graph. Feeding it an edge that does
   * not exist in `TripStatus::allowedTransitions()` today proves it: the button
   * appears because the server said so, not because this app agreed.
   *
   * Mutation check — replace the `trip.allowed_transitions` read with any
   * hardcoded map and this fails.
   */
  it('renders whatever edges the server sends, including ones not in the graph today', () => {
    const invented = tripWith('driver_arrived', ['trip_started']);

    expect(driverActions(invented).map((action) => action.to)).toEqual(['trip_started']);
  });

  it('renders nothing when the server offers nothing', () => {
    expect(driverActions(tripWith('trip_completed', []))).toEqual([]);
  });

  /**
   * `allowed_transitions` is state-legality, not permission — `TripResource`
   * says so in as many words. From `assigned` the server legally allows
   * `cancelled`, and `TripPolicy` refuses it to a driver: cancelling is
   * dispatch's act. Rendering the field verbatim would put a button on the
   * screen whose only possible outcome is a 403.
   *
   * Mutation check — drop the `DRIVER_ACTIONABLE_STATUSES` filter and this
   * fails on `cancelled`.
   */
  it('drops transitions that are legal for the trip but forbidden to a driver', () => {
    const assigned = tripWith('assigned', ['accepted', 'rejected', 'cancelled']);

    expect(driverActions(assigned).map((action) => action.to)).toEqual(['accepted', 'rejected']);
  });

  it('drops no_show, which belongs to the office', () => {
    const arrived = tripWith('driver_arrived', ['passenger_onboard', 'no_show', 'cancelled']);

    expect(driverActions(arrived).map((action) => action.to)).toEqual(['passenger_onboard']);
  });

  it('keeps the server ordering rather than imposing its own', () => {
    const started = tripWith('trip_started', ['waiting', 'trip_completed']);

    expect(driverActions(started).map((action) => action.to)).toEqual([
      'waiting',
      'trip_completed',
    ]);
  });

  /**
   * The odometer reading is one of the six data points the anchor client
   * accepts this platform on. Asking for it is not a nicety — a transition
   * posted without it is a 422 the driver cannot act on.
   *
   * Mutation check — clear `ACTION_REQUIREMENTS` and this fails.
   */
  it('demands an opening reading to start and a closing reading to complete', () => {
    const onboard = driverActions(tripWith('passenger_onboard', ['trip_started']));
    expect(onboard[0]?.requires).toBe('odometer_start');

    const resumed = driverActions(tripWith('trip_resumed', ['waiting', 'trip_completed']));
    expect(resumed.find((action) => action.to === 'trip_completed')?.requires).toBe('odometer_end');
  });

  it('demands a reason to decline, because the server does', () => {
    const assigned = driverActions(tripWith('assigned', ['accepted', 'rejected']));

    expect(assigned.find((action) => action.to === 'rejected')?.requires).toBe('notes');
    expect(assigned.find((action) => action.to === 'accepted')?.requires).toBeNull();
  });

  it('asks for nothing on a plain progress step', () => {
    const accepted = driverActions(tripWith('accepted', ['driver_en_route']));

    expect(accepted[0]?.requires).toBeNull();
  });

  /**
   * ADR-0047: with `tracking.odometer_enabled` off, the server prices the
   * trip from its GPS trace and never asks for a reading. Continuing to
   * demand one would put a form in front of a driver for a number nobody
   * wants — and, worse, the action stays behind that form.
   */
  it('drops the reading requirement when the office has switched the odometer off', () => {
    const onboard = driverActions(tripWith('passenger_onboard', ['trip_started']), {
      odometerEnabled: false,
    });

    expect(onboard[0]?.requires).toBeNull();
    // The *action* survives — this is the difference between "no reading" and
    // "no way to start the trip".
    expect(onboard[0]?.to).toBe('trip_started');

    const resumed = driverActions(tripWith('trip_resumed', ['waiting', 'trip_completed']), {
      odometerEnabled: false,
    });

    expect(resumed.find((action) => action.to === 'trip_completed')?.requires).toBeNull();
  });

  it('still demands a reason to decline when the odometer is off', () => {
    // The two requirements are unrelated and the switch must not conflate
    // them: a rejection needs a reason because the office has to read it,
    // which has nothing to do with mileage.
    const assigned = driverActions(tripWith('assigned', ['accepted', 'rejected']), {
      odometerEnabled: false,
    });

    expect(assigned.find((action) => action.to === 'rejected')?.requires).toBe('notes');
  });

  it('keeps asking for a reading when the caller says nothing about the setting', () => {
    // The default matters more than it looks. A screen that has not been
    // taught about the setting must keep the behaviour the app has always
    // had — defaulting the other way would silently drop the reading from
    // any surface somebody forgot to update, and the symptom is a 422 the
    // driver reads on the sync queue hours after leaving the vehicle.
    const onboard = driverActions(tripWith('passenger_onboard', ['trip_started']), {});

    expect(onboard[0]?.requires).toBe('odometer_start');
  });
});

describe('shouldStreamGps', () => {
  /**
   * The window is `trip_started` to `trip_completed` and nothing wider.
   *
   * `RouteDistanceCalculator` sums every ping on a trip with no time bound,
   * and `TripStateMachine::reconcileAgainstGps` compares that total against
   * `odometer_end - odometer_start` — which excludes the drive to the pickup.
   * Streaming while en route adds kilometres to one side of that comparison
   * and not the other, and raises a variance flag on a trip where the driver
   * did nothing wrong. PROJECT.md commits to reviewing those flags within two
   * business days, so a flag that fires on every long pickup is a flag that
   * gets ignored.
   *
   * Mutation check — add `driver_en_route` to the streaming set and this fails.
   */
  it('does not stream before the opening odometer is captured', () => {
    expect(shouldStreamGps('assigned')).toBe(false);
    expect(shouldStreamGps('accepted')).toBe(false);
    expect(shouldStreamGps('driver_en_route')).toBe(false);
    expect(shouldStreamGps('driver_arrived')).toBe(false);
    expect(shouldStreamGps('passenger_onboard')).toBe(false);
  });

  it('streams for the whole live trip, waiting included', () => {
    expect(shouldStreamGps('trip_started')).toBe(true);
    expect(shouldStreamGps('waiting')).toBe(true);
    expect(shouldStreamGps('trip_resumed')).toBe(true);
  });

  it('stops once the trip is closed out', () => {
    expect(shouldStreamGps('trip_completed')).toBe(false);
    expect(shouldStreamGps('cancelled')).toBe(false);
    expect(shouldStreamGps('no_show')).toBe(false);
  });
});

describe('streamingTripId', () => {
  it('finds the live trip anywhere in the list', () => {
    expect(
      streamingTripId([
        tripWith('assigned', []),
        { ...tripWith('waiting', []), id: 77 },
        tripWith('trip_completed', []),
      ]),
    ).toBe(77);
  });

  /**
   * Mutation check — return the first trip in the list instead of null and
   * this fails: the app would record a route against a trip that has not
   * started, inflating `gps_distance_km` against an odometer span that does
   * not include it.
   */
  it('streams for nothing when no trip is live', () => {
    expect(streamingTripId([tripWith('assigned', []), tripWith('driver_en_route', [])])).toBeNull();
  });

  it('is null on an empty list rather than throwing', () => {
    expect(streamingTripId([])).toBeNull();
  });

  /**
   * Two live trips should be impossible — `TripAssignmentGuard` holds
   * pessimistic locks to make sure of it. If the invariant ever breaks,
   * recording the newer route beats crashing or recording the older one.
   */
  it('picks the most recently started if the impossible happens', () => {
    const older = { ...tripWith('trip_started', []), id: 1, started_at: '2026-08-07T06:00:00Z' };
    const newer = { ...tripWith('trip_started', []), id: 2, started_at: '2026-08-07T09:00:00Z' };

    expect(streamingTripId([newer, older])).toBe(2);
    expect(streamingTripId([older, newer])).toBe(2);
  });
});

describe('isInProgress', () => {
  it('counts every state where the driver is working the trip', () => {
    expect(isInProgress('driver_en_route')).toBe(true);
    expect(isInProgress('waiting')).toBe(true);
  });

  it('does not count work that has not started or has finished', () => {
    expect(isInProgress('assigned')).toBe(false);
    expect(isInProgress('accepted')).toBe(false);
    expect(isInProgress('trip_completed')).toBe(false);
  });
});

describe('activeTripRoute', () => {
  it('sends each live status to the screen that owns it', () => {
    expect(activeTripRoute('accepted')).toBe('Pickup');
    expect(activeTripRoute('driver_en_route')).toBe('Pickup');
    expect(activeTripRoute('driver_arrived')).toBe('WaitingForPassenger');
    expect(activeTripRoute('trip_started')).toBe('TripInProgress');
    expect(activeTripRoute('waiting')).toBe('TripInProgress');
    expect(activeTripRoute('trip_resumed')).toBe('TripInProgress');
  });

  it('sends passenger_onboard to the odometer, not to the record', () => {
    // The gap this function was extracted to close. It fell through every
    // predicate and landed on TripDetail — a page read at a standstill — when
    // the only legal move from that state is `trip_started`, and the opening
    // reading is the only thing standing in the way. Found on a real handset
    // after a driver backed out of the odometer modal.
    expect(activeTripRoute('passenger_onboard')).toBe('Odometer');
  });

  it('falls back to the record for anything with no live screen', () => {
    expect(activeTripRoute('assigned')).toBe('TripDetail');
    expect(activeTripRoute('trip_completed')).toBe('TripDetail');
    expect(activeTripRoute('cancelled')).toBe('TripDetail');
    expect(activeTripRoute('no_show')).toBe('TripDetail');
  });

  it('never sends one status to two screens', () => {
    // The invariant `docs/agent-worklog.md` keeps as a table. Asserted here so
    // widening a predicate cannot quietly take a status off another screen.
    const live: TripStatus[] = [
      'accepted',
      'driver_en_route',
      'driver_arrived',
      'passenger_onboard',
      'trip_started',
      'waiting',
      'trip_resumed',
    ];

    const pairs = live.filter(
      (s) =>
        [isPickupPhase(s), isWaitingForPassenger(s), isTripInProgress(s), s === 'passenger_onboard']
          .filter(Boolean).length !== 1,
    );

    expect(pairs).toEqual([]);
  });
});

describe('isLiveLeg', () => {
  it('counts an accepted trip as live, which isInProgress does not', () => {
    // The bug, in one assertion. A driver accepted a real offer, the trip
    // landed in `accepted`, and HomeScreen — which picked its active trip with
    // `isInProgress` — rendered no card at all. The passenger was waiting and
    // the app looked idle.
    expect(isLiveLeg('accepted')).toBe(true);
    expect(isInProgress('accepted')).toBe(false);
  });

  it('covers every status that has a screen of its own', () => {
    for (const status of [
      'accepted',
      'driver_en_route',
      'driver_arrived',
      'passenger_onboard',
      'trip_started',
      'waiting',
      'trip_resumed',
    ] as TripStatus[]) {
      expect(isLiveLeg(status)).toBe(true);
      expect(activeTripRoute(status)).not.toBe('TripDetail');
    }
  });

  it('leaves anything the driver is not doing alone', () => {
    for (const status of [
      'assigned',
      'rejected',
      'no_show',
      'trip_completed',
      'cancelled',
    ] as TripStatus[]) {
      expect(isLiveLeg(status)).toBe(false);
    }
  });

  it('does not widen isInProgress, which orders the list', () => {
    // `ordering.ts` groups `assigned` and `accepted` as *upcoming*. A
    // corporate trip accepted for four o'clock is not something the driver is
    // doing at ten, and pinning it as in-progress would say otherwise.
    expect(isInProgress('assigned')).toBe(false);
    expect(isInProgress('accepted')).toBe(false);
  });
});

describe('tripDestination', () => {
  it('never sends a live trip to the record view', () => {
    // The whole point. Today's list sent every trip to `TripDetail`, so
    // tapping a live job landed a driver on an odometer table of em dashes
    // with a "Start trip" button on a trip whose passenger was already
    // aboard. Reported from a handset as "wrong and misleading".
    for (const status of [
      'accepted',
      'driver_en_route',
      'driver_arrived',
      'passenger_onboard',
      'trip_started',
      'waiting',
      'trip_resumed',
    ] as TripStatus[]) {
      expect(tripDestination(status, 42).screen).not.toBe('TripDetail');
    }
  });

  it('carries the odometer its transition, which a bare trip id cannot', () => {
    const to = tripDestination('passenger_onboard', 42);

    expect(to).toEqual({
      screen: 'Odometer',
      params: { tripId: 42, to: 'trip_started', from: 'passenger_onboard' },
    });
  });

  it('keeps the record for trips that are over, or never started', () => {
    // `TripDetail` is not removed and should not be — the timeline and the
    // odometer pair are exactly what a finished trip is read for.
    for (const status of ['assigned', 'trip_completed', 'cancelled', 'no_show'] as TripStatus[]) {
      expect(tripDestination(status, 42)).toEqual({
        screen: 'TripDetail',
        params: { tripId: 42 },
      });
    }
  });
});
