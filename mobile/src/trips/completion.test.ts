import type { Trip, TripEarnings } from '../api/types';
import {
  confirmationNote,
  earningsAnnouncement,
  earningsRows,
  isConfirmed,
  primaryAction,
} from './completion';

/**
 * The money on the completion screen.
 *
 * Every case here exists because the mockup for this screen asked for
 * something the platform cannot produce, or would have produced wrongly:
 *
 * - a tip, which does not exist anywhere on this platform;
 * - "Your earnings" set to the *gross* fare plus a tip;
 * - a "Platform fee" that was not the platform's fee of that fare;
 * - a "Total" that repeated the fare after a subtraction.
 */
function trip(earnings: TripEarnings | null): Trip {
  return {
    id: 42,
    tenant_id: null,
    customer_id: 9,
    booking_id: null,
    vehicle_id: 7,
    driver_id: 3,
    origin: 'Acacia Mall, 14-18 Cooper Rd',
    destination: 'Kololo Airstrip',
    pickup: { label: 'Acacia Mall, 14-18 Cooper Rd', latitude: null, longitude: null },
    dropoff: { label: 'Kololo Airstrip', latitude: null, longitude: null },
    service_type: null,
    reference: null,
    package: null,
    status: 'trip_completed',
    allowed_transitions: [],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 2000,
    payment: null,
    odometer_start: 104_320,
    odometer_end: 104_332,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: '12.00',
    gps_distance_km: null,
    distance_variance_flagged: false,
    unplanned_stop_count: 0,
    started_at: '2026-08-15T08:00:00+03:00',
    completed_at: '2026-08-15T08:40:00+03:00',
    duration_minutes: 40,
    fare: null,
    estimated_fare: null,
    earnings,
    passenger_contact: null,
    created_at: null,
    updated_at: null,
  };
}

const settled: TripEarnings = {
  // Empty here on purpose: `completion.ts` reads the three figures, and the
  // per-trip rows are the trip *record*'s concern rather than this screen's.
  lines: [],
  earned_minor: 10_000,
  commission_minor: 2_500,
  total_minor: 12_500,
  currency: 'UGX',
  recorded_at: '2026-08-15T08:40:12+03:00',
};

describe('the breakdown', () => {
  it('states the fare, the fee and what is left, in that order', () => {
    const rows = earningsRows(trip(settled));

    expect(rows).not.toBeNull();
    expect(rows?.map((row) => row.label)).toEqual(['Fare', 'Platform fee', 'You earned']);
    expect(rows?.map((row) => row.amount)).toEqual(['UGX 12,500', 'UGX 2,500', 'UGX 10,000']);
  });

  it('emphasises the driver’s share and nothing else', () => {
    // The one figure the screen exists to state. The mockup emphasised the
    // gross fare *and* called it "Your earnings", which is the confusion this
    // whole screen was rebuilt to avoid.
    const rows = earningsRows(trip(settled));

    expect(rows?.filter((row) => row.emphasis).map((row) => row.label)).toEqual(['You earned']);
  });

  it('carries the fee’s direction as a sign flag, not inside the money string', () => {
    // A formatter that emitted "-UGX 2,500" would repeat the mistake
    // `walletValue` was changed to stop making: a minus is easy to miss and
    // silent about direction. The label carries the meaning.
    const rows = earningsRows(trip(settled));

    expect(rows?.find((row) => row.label === 'Platform fee')?.sign).toBe('minus');
    expect(rows?.find((row) => row.label === 'Platform fee')?.amount).toBe('UGX 2,500');
    expect(rows?.find((row) => row.label === 'You earned')?.sign).toBe('none');
  });

  it('never divides a zero-decimal currency', () => {
    // The exact bug the home screen shipped: UGX minor units *are* whole
    // shillings, and dividing by 100 renders a 12,500-shilling job as "UGX
    // 125".
    const rows = earningsRows(trip(settled));

    expect(rows?.[0]?.amount).toBe('UGX 12,500');
    expect(rows?.[0]?.amount).not.toBe('UGX 125');
  });

  it('shows the exact figure rather than the compact one', () => {
    // `compactMoney` hides up to 100 shillings inside a "K". That is fine on a
    // glanceable tile and not fine on money somebody is about to be paid.
    const rows = earningsRows(
      trip({ ...settled, earned_minor: 145_600, total_minor: 182_000, commission_minor: 36_400 }),
    );

    expect(rows?.find((row) => row.label === 'You earned')?.amount).toBe('UGX 145,600');
    expect(rows?.find((row) => row.label === 'You earned')?.amount).not.toBe('UGX 145.6K');
  });

  it('has no tip row, because the platform has no concept of one', () => {
    const rows = earningsRows(trip(settled));

    expect(rows?.map((row) => row.label)).not.toContain('Tip');
    expect(rows).toHaveLength(3);
  });

  it('does not state the commission percentage', () => {
    // It is a runtime setting the office can change and it is not in the
    // payload. A handset that printed "20%" would go on printing it after
    // they changed it — the audit agent's finding 5, in a new place.
    const rows = earningsRows(trip(settled));

    expect(rows?.find((row) => row.label.includes('%'))).toBeUndefined();
  });

  it('renders whatever was recorded, without recomputing the split', () => {
    // A corrected credit under ADR-0029's append-only rule: 11,000 of a
    // 12,500 fare leaves 1,500, which is no percentage of 12,500 the office
    // would ever set. The screen must show it anyway.
    const rows = earningsRows(
      trip({ ...settled, earned_minor: 11_000, commission_minor: 1_500 }),
    );

    expect(rows?.find((row) => row.label === 'You earned')?.amount).toBe('UGX 11,000');
    expect(rows?.find((row) => row.label === 'Platform fee')?.amount).toBe('UGX 1,500');
  });
});

describe('the trip the office has not confirmed yet', () => {
  it('has no rows at all, rather than a row of em dashes', () => {
    // Three blank money lines leave a driver unable to tell "the ride was
    // worthless" from "the phone is behind". Those need different reactions,
    // so the screen says which in a sentence instead.
    expect(earningsRows(trip(null))).toBeNull();
    expect(isConfirmed(trip(null))).toBe(false);
  });

  it('explains that the trip is saved and will be sent', () => {
    const note = confirmationNote(trip(null));

    expect(note).toContain('saved on this phone');
    expect(note).toContain('connection');
  });

  it('says nothing once the figures have arrived', () => {
    expect(confirmationNote(trip(settled))).toBeNull();
    expect(isConfirmed(trip(settled))).toBe(true);
  });

  it('treats a trip that has not loaded the same as one not yet confirmed', () => {
    expect(isConfirmed(undefined)).toBe(false);
    expect(earningsRows(undefined)).toBeNull();
    expect(confirmationNote(undefined)).not.toBeNull();
  });
});

describe('the screen reader sentence', () => {
  it('says the fee was subtracted, which a cell-by-cell read does not', () => {
    const said = earningsAnnouncement(trip(settled));

    expect(said).toContain('less a platform fee');
    expect(said).toContain('You earned UGX 10,000');
  });

  it('says so plainly when nothing is confirmed', () => {
    expect(earningsAnnouncement(trip(null))).toBe('Earnings are not confirmed yet.');
  });
});

describe('the primary button', () => {
  it('offers to go online only to a driver who is actually offline', () => {
    // The mockup said "Back Online". Completing a trip does not take a driver
    // off duty, so for the common case there is nothing to come back from.
    expect(primaryAction(true)).toEqual({ label: 'Back to work', goesOnDuty: false });
  });

  it('does the honest version of the mockup for a driver who is off duty', () => {
    expect(primaryAction(false)).toEqual({ label: 'Go online', goesOnDuty: true });
  });
});
