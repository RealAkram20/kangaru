import type { Trip, TripStatus } from '../api/types';
import { orderTripsForToday } from './ordering';

function trip(id: number, status: TripStatus, createdAt: string | null): Trip {
  return {
    id,
    tenant_id: 1,
    booking_id: null,
    vehicle_id: 1,
    driver_id: 1,
    origin: 'Kampala',
    destination: 'Gulu',
    status,
    allowed_transitions: [],
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
    created_at: createdAt,
    updated_at: null,
  };
}

const ids = (trips: Trip[]) => trips.map((item) => item.id);

describe('orderTripsForToday', () => {
  /**
   * Mutation check — remove the grouping and sort on `created_at` alone and
   * this fails: the trip the driver is physically sitting in falls below two
   * older ones they have not started.
   */
  it('pins the trip in progress above everything else', () => {
    const ordered = orderTripsForToday([
      trip(1, 'assigned', '2026-08-07T06:00:00Z'),
      trip(2, 'trip_started', '2026-08-07T09:00:00Z'),
      trip(3, 'accepted', '2026-08-07T07:00:00Z'),
    ]);

    expect(ids(ordered)).toEqual([2, 1, 3]);
  });

  it('puts finished work below work still to do', () => {
    const ordered = orderTripsForToday([
      trip(1, 'trip_completed', '2026-08-07T05:00:00Z'),
      trip(2, 'cancelled', '2026-08-07T04:00:00Z'),
      trip(3, 'assigned', '2026-08-07T10:00:00Z'),
    ]);

    expect(ids(ordered)).toEqual([3, 2, 1]);
  });

  /**
   * Ascending, not the server's descending. The API sorts newest first, which
   * is right for a dispatcher's audit list and backwards for a driver's day.
   *
   * Mutation check — flip the comparator and this fails.
   */
  it('orders each group oldest first, as the nearest thing to soonest first', () => {
    const ordered = orderTripsForToday([
      trip(1, 'assigned', '2026-08-07T12:00:00Z'),
      trip(2, 'assigned', '2026-08-07T08:00:00Z'),
      trip(3, 'assigned', '2026-08-07T10:00:00Z'),
    ]);

    expect(ids(ordered)).toEqual([2, 3, 1]);
  });

  /**
   * A null or unparseable `created_at` must not make the comparator return
   * NaN. It would leave the sort unstable, and a list that silently reorders
   * itself between renders is worse than one in the wrong order.
   *
   * Mutation check — return `Date.parse(value)` unguarded and this fails.
   */
  it('sorts a trip with no timestamp last rather than randomly', () => {
    const ordered = orderTripsForToday([
      trip(1, 'assigned', null),
      trip(2, 'assigned', '2026-08-07T08:00:00Z'),
      trip(3, 'assigned', 'not a date'),
    ]);

    expect(ids(ordered)[0]).toBe(2);
    expect(ids(ordered)).toHaveLength(3);
  });

  it('does not mutate the array it was given', () => {
    const input = [trip(1, 'assigned', '2026-08-07T12:00:00Z'), trip(2, 'trip_started', null)];
    orderTripsForToday(input);

    expect(ids(input)).toEqual([1, 2]);
  });
});
