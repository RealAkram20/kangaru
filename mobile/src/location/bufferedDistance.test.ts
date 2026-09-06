import { bufferedDistanceKm, disagreesWithBuffer, metresBetween } from './bufferedDistance';
import type { Ping } from './pings';

/**
 * What the handset measures of its own buffered pings (ADR-0045 §5) — the
 * figure behind the odometer warning and the kerb fare.
 *
 * Points sit on the equator so a degree of longitude is 111.32 km and the
 * offsets read as metres directly: 0.001° ≈ 111 m, 0.00001° ≈ 1.1 m.
 */
function ping(lngOffset: number, options: Partial<Ping> = {}): Ping {
  return {
    position: { lat: 0, lng: 32.5 + lngOffset },
    recordedAt: new Date(1_700_000_000_000).toISOString(),
    speedKph: 40,
    headingDegrees: 90,
    accuracyMetres: 12,
    isMock: false,
    ...options,
  };
}

describe('bufferedDistanceKm', () => {
  it('sums the hops of a clean drive', () => {
    // Ten hops of ~111.3 m.
    const pings = Array.from({ length: 11 }, (_, i) => ping(i * 0.001));

    expect(bufferedDistanceKm(pings)).toBeCloseTo(1.11, 2);
  });

  it('answers null — not zero — for fewer than two usable pings', () => {
    // "This phone has nothing to say" and "the vehicle did not move" are
    // different claims, and a screen renders them differently.
    expect(bufferedDistanceKm([])).toBeNull();
    expect(bufferedDistanceKm([ping(0)])).toBeNull();
  });

  it('drops mock-location fixes entirely, and answers null when only they remain', () => {
    const mixed = [ping(0), ping(0.5, { isMock: true }), ping(0.001)];

    // The faked position sits 55 km away and must contribute nothing.
    expect(bufferedDistanceKm(mixed)).toBeCloseTo(0.11, 2);
    expect(bufferedDistanceKm([ping(0, { isMock: true }), ping(0.001, { isMock: true })])).toBeNull();
  });

  it('ignores receiver jitter from a parked vehicle', () => {
    // Twelve fixes wandering about a metre: the vehicle did not move.
    const parked = Array.from({ length: 12 }, (_, i) => ping(0.00001 * (i % 2)));

    expect(bufferedDistanceKm(parked)).toBe(0);
  });

  it('measures from the last kept fix, so jitter between two real hops does not shorten them', () => {
    // 111 m, then a 1 m wobble, then another 111 m from where the vehicle
    // actually was.
    const pings = [ping(0), ping(0.001), ping(0.00101), ping(0.002)];

    expect(bufferedDistanceKm(pings)).toBeCloseTo(0.22, 2);
  });

  it('measures a known distance the way the server does', () => {
    // The same haversine the backend uses, to the metre.
    expect(metresBetween({ lat: 0, lng: 32.5 }, { lat: 0, lng: 32.501 })).toBeCloseTo(111.19, 1);
  });
});

describe('disagreesWithBuffer', () => {
  it('warns when the typed figure is further from the measurement than the threshold', () => {
    // 13 km typed against 6 km measured is 54% out.
    expect(disagreesWithBuffer(13, 6, 10)).toBe(true);
  });

  it('stays quiet inside the threshold', () => {
    // GPS reads a little short on a curve; 50 typed against 49 measured is 2%.
    expect(disagreesWithBuffer(50, 49, 10)).toBe(false);
  });

  it('is a share of the typed figure, exactly as the server computes it', () => {
    // 10% of 100 is 10, so 110 measured is on the line and 111 is over.
    expect(disagreesWithBuffer(100, 110, 10)).toBe(false);
    expect(disagreesWithBuffer(100, 111, 10)).toBe(true);
  });

  it('says nothing when there is nothing to compare', () => {
    // No measurement, no threshold, or a zero delta: a warning nobody can act
    // on is noise, and it sits between the driver and the only button.
    expect(disagreesWithBuffer(13, null, 10)).toBe(false);
    expect(disagreesWithBuffer(13, 6, null)).toBe(false);
    expect(disagreesWithBuffer(0, 6, 10)).toBe(false);
  });
});
