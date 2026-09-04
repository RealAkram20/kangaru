import { boundsFor, greatCircleKm, located, toCoordinates } from './places';

/**
 * Places, and the distance between them.
 *
 * Pure TypeScript over fixtures, which is what `jest.setup.ts` says the
 * trustworthy suites in this app look like. What is asserted is not layout —
 * it is the two ways this module can be *wrong* rather than merely ugly: a
 * distance that is off by enough to change a driver's decision, and a
 * coordinate pair that gets used when only half of it exists.
 *
 * Kampala city centre is 0.3476 N, 32.5825 E. 0.01 of latitude is ~1.11 km
 * anywhere on earth, which is what makes these assertions checkable by hand.
 */

const CENTRE = { lat: 0.3476, lng: 32.5825 };

describe('located', () => {
  it('accepts a place with both coordinates', () => {
    expect(located({ label: 'Acacia Mall', latitude: 0.3676, longitude: 32.5825 })).toBe(true);
  });

  it('refuses a place with only half a position', () => {
    // The failure this exists to prevent is a screen doing `latitude ?? 0`.
    // Uganda sits near 0°N, so a missing longitude defaulted to zero puts the
    // vehicle in the Atlantic off Ghana — the swap ADR-0020 records this
    // codebase hitting for real, arrived at from the other direction.
    expect(located({ label: 'Somewhere', latitude: 0.3476, longitude: null })).toBe(false);
    expect(located({ label: 'Somewhere', latitude: null, longitude: 32.5825 })).toBe(false);
  });

  it('refuses a place with no position at all, and a missing place', () => {
    // The ordinary case: an order a dispatcher keyed in over the phone.
    expect(located({ label: 'Kololo', latitude: null, longitude: null })).toBe(false);
    expect(located(null)).toBe(false);
    expect(located(undefined)).toBe(false);
  });

  it('refuses a position that is not a finite number', () => {
    // A NaN reaching a map centres it on nothing and renders a grey square;
    // reaching a distance renders an em dash where a figure was available.
    expect(located({ label: 'Broken', latitude: Number.NaN, longitude: 32.5825 })).toBe(false);
  });
});

describe('greatCircleKm', () => {
  it('measures a short Kampala hop', () => {
    // 0.02 of latitude due north is ~2.22 km.
    const north = { lat: 0.3676, lng: 32.5825 };

    expect(greatCircleKm(CENTRE, north)).toBeGreaterThan(2.1);
    expect(greatCircleKm(CENTRE, north)).toBeLessThan(2.3);
  });

  it('is zero between a point and itself', () => {
    expect(greatCircleKm(CENTRE, CENTRE)).toBe(0);
  });

  it('does not care which way round the two points are given', () => {
    const north = { lat: 0.3676, lng: 32.5825 };

    expect(greatCircleKm(CENTRE, north)).toBeCloseTo(greatCircleKm(north, CENTRE), 9);
  });

  it('measures east-west as well as north-south, which a latitude-only bug would not', () => {
    // 0.02 of *longitude* at the equator is also ~2.22 km. A haversine that
    // dropped the longitude term would return 0 here and pass every test
    // above it.
    const east = { lat: 0.3476, lng: 32.6025 };

    expect(greatCircleKm(CENTRE, east)).toBeGreaterThan(2.1);
    expect(greatCircleKm(CENTRE, east)).toBeLessThan(2.3);
  });

  it('never returns NaN for antipodal points', () => {
    // No taxi drives this, but `asin` returns NaN here where `atan2` does not,
    // and a NaN would render as an em dash on a screen that had a distance.
    expect(Number.isFinite(greatCircleKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }))).toBe(true);
  });
});

describe('boundsFor', () => {
  it('puts longitude first in each pair, as GeoJSON wants', () => {
    // The assertion that matters most in this file. Every other part of the
    // app says `lat, lng`; GeoJSON and the server say the opposite, and Uganda's
    // coordinates pass every range check either way round — so a swap here is
    // invisible except that the map shows the Indian Ocean.
    const bounds = boundsFor([CENTRE]);

    expect(bounds).not.toBeNull();

    const [[west, south], [east, north]] = bounds!;

    // Longitude ~32.58, latitude ~0.35. If the pairs were swapped these two
    // assertions would both fail.
    expect(west).toBeGreaterThan(32);
    expect(east).toBeGreaterThan(32);
    expect(south).toBeLessThan(1);
    expect(north).toBeLessThan(1);
  });

  it('holds every point given', () => {
    const north = { lat: 0.3676, lng: 32.5825 };
    const bounds = boundsFor([CENTRE, north])!;

    const [[west, south], [east, northEdge]] = bounds;

    expect(south).toBeLessThan(CENTRE.lat);
    expect(northEdge).toBeGreaterThan(north.lat);
    expect(west).toBeLessThan(CENTRE.lng);
    expect(east).toBeGreaterThan(CENTRE.lng);
  });

  it('gives a single point a box with real size', () => {
    // Fitting a map to a zero-size box asks for infinite zoom, which renders
    // as a grey square rather than as a street.
    const [[west, south], [east, north]] = boundsFor([CENTRE])!;

    expect(east - west).toBeGreaterThan(0.005);
    expect(north - south).toBeGreaterThan(0.005);
  });

  it('has no box for no points', () => {
    expect(boundsFor([])).toBeNull();
  });
});

describe('toCoordinates', () => {
  it('reads a place into named fields, never a positional pair', () => {
    expect(toCoordinates({ label: 'Acacia Mall', latitude: 0.3676, longitude: 32.5825 })).toEqual({
      lat: 0.3676,
      lng: 32.5825,
    });
  });
});
