import type { Trip, TripStatus } from '../api/types';
import { driverActions, isInProgress, shouldStreamGps, streamingTripId } from './transitions';

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
    status,
    allowed_transitions: allowed,
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
