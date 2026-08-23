import type { TripRoute, TripStop } from '../api/types';
import { journeyAnnouncement, journeyProgress, journeyTotal } from './journey';
import { pickupIsLegOrigin } from './stops';

/**
 * The figure under the map, and the rules that keep it from becoming a lie.
 *
 * Two of these tests are about arithmetic and the rest are about refusals.
 * That ratio is the point: `docs/screen-rules.md` §1 and `Handover.tsx`
 * between them forbid almost every shape this feature could have taken, and
 * what is left is a ratio of two measured road distances.
 */

function route(distanceKm: number, durationSeconds: number | null = null): TripRoute {
  return {
    polyline: 'a~l~Fjk~uOwHJy@P',
    distance_km: distanceKm,
    duration_seconds: durationSeconds,
    provider: 'osrm',
    is_estimate: true,
  };
}

function stop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    id: 1,
    sequence: 1,
    label: 'Centenary Bank, Kabalagala',
    latitude: 0.3,
    longitude: 32.6,
    source: 'planned',
    status: 'pending',
    arrived_at: null,
    departed_at: null,
    skip_reason: null,
    client_place_id: null,
    ...overrides,
  };
}

describe('how far through the drive', () => {
  it('is the share of the measured road that is behind the driver', () => {
    // 12.0 km of road, 3.0 km of it left: three quarters driven.
    expect(journeyProgress(3, 12)).toBeCloseTo(0.75);
  });

  it('is nothing at the kerb and everything at the door', () => {
    expect(journeyProgress(12, 12)).toBe(0);
    expect(journeyProgress(0, 12)).toBe(1);
  });

  it('does not run backwards past its own start when the driver detours', () => {
    // The remaining road can genuinely exceed the whole leg — a wrong turn, or
    // simply a fix taken before the driver reached the pickup, since the leg
    // is measured *from* the pickup. A bar running off the left end reads as
    // broken; a bar sitting at zero reads as "you have not gained yet", which
    // is what has happened.
    expect(journeyProgress(19, 12)).toBe(0);
  });

  it('does not overshoot the far end either', () => {
    // The two roads are separate measurements taken at different moments, so
    // "remaining" can land slightly negative against a leg measured earlier.
    expect(journeyProgress(-0.4, 12)).toBe(1);
  });

  it('refuses to divide by a leg with no length', () => {
    // Pickup and drop-off keyed to the same spot is a real desk mistake, and
    // an Infinity here would render as a bar of NaN width.
    expect(journeyProgress(0, 0)).toBeNull();
    expect(journeyProgress(3, -12)).toBeNull();
  });

  it('answers null rather than zero when either road is missing', () => {
    // The distinction §1 exists for: a zero is a claim that the driver has not
    // moved, where null is "nobody measured this". They render differently —
    // null draws no bar at all.
    expect(journeyProgress(null, 12)).toBeNull();
    expect(journeyProgress(3, null)).toBeNull();
    expect(journeyProgress(undefined, undefined)).toBeNull();
    expect(journeyProgress(Number.NaN, 12)).toBeNull();
  });
});

describe('the whole leg, as a figure', () => {
  it('is spoken in the same words as every other distance in the app', () => {
    expect(journeyTotal(route(12.14))).toBe('12.1 km');
  });

  it('is null when the leg was never measured', () => {
    expect(journeyTotal(null)).toBeNull();
    expect(journeyTotal(undefined)).toBeNull();
  });
});

describe('what a screen reader is told', () => {
  it('gives both distances rather than a percentage', () => {
    // A percentage read out mid-drive is the figure most likely to be heard as
    // time remaining, which is the claim this whole module refuses to make.
    const spoken = journeyAnnouncement({
      remaining: '3.0 km',
      total: '12.1 km',
      byRoad: true,
      durationSeconds: null,
    });

    expect(spoken).toBe('3.0 km to go of 12.1 km by road.');
    expect(spoken).not.toMatch(/%|per cent|percent/);
  });

  it('says minutes only when the provider sent them, and hedges them', () => {
    // ADR-0031 §6: a provider duration is a forecast and is shown as one. The
    // layout carries "about" in front of the figure; a spoken sentence loses
    // whatever hedging the layout was doing, so it says so itself.
    expect(
      journeyAnnouncement({
        remaining: '3.0 km',
        total: '12.1 km',
        byRoad: true,
        durationSeconds: 780,
      }),
    ).toBe('3.0 km to go of 12.1 km by road. About 13 minutes, estimated.');
  });

  it('never derives minutes of its own', () => {
    const spoken = journeyAnnouncement({
      remaining: '3.0 km',
      total: '12.1 km',
      byRoad: true,
      durationSeconds: null,
    });

    expect(spoken).not.toMatch(/minute/);
  });

  it('says which kind of distance it is when there is no whole leg to compare', () => {
    // The fallback picture: a straight line and no bar. It must not be spoken
    // in the same words as a measured road.
    expect(
      journeyAnnouncement({
        remaining: '3.0 km',
        total: null,
        byRoad: false,
        durationSeconds: null,
      }),
    ).toBe('3.0 km to go, straight line rather than by road.');
  });

  it('says plainly that there is no figure, rather than reading out a dash', () => {
    expect(
      journeyAnnouncement({ remaining: null, total: null, byRoad: false, durationSeconds: null }),
    ).toBe('Distance to the destination is not available.');
  });
});

describe('whether the pickup is still where this leg started', () => {
  it('is true for the ordinary trip, which has no stops at all', () => {
    expect(pickupIsLegOrigin([])).toBe(true);
  });

  it('stays true while every stop is still ahead of the driver', () => {
    expect(pickupIsLegOrigin([stop(), stop({ id: 2, sequence: 2 })])).toBe(true);
  });

  it('goes false the moment one has been worked', () => {
    // The bank circuit: five ATMs, one driver. After the first, the leg runs
    // ATM to ATM and no longer starts at the branch — so `pickup → next stop`
    // is a different journey from the one being driven, and comparing them
    // would read as negative progress on a driver who has done most of the
    // work.
    expect(pickupIsLegOrigin([stop({ status: 'done' }), stop({ id: 2, sequence: 2 })])).toBe(false);
    expect(pickupIsLegOrigin([stop({ status: 'arrived' })])).toBe(false);
  });

  it('counts a skipped stop as worked', () => {
    // §6's case. Nobody stopped, but the leg moved on regardless.
    expect(pickupIsLegOrigin([stop({ status: 'skipped' })])).toBe(false);
  });
});
