import { looksLikeServiceArea, toPingBody, type Ping } from './pings';

/**
 * Kampala. Latitude 0.3476°N, longitude 32.5825°E — the pair the backend has
 * twice been bitten by, because swapping them passes every range check either
 * field could impose.
 */
const KAMPALA: Ping = {
  position: { lat: 0.3476, lng: 32.5825 },
  recordedAt: '2026-08-07T08:00:00.000Z',
  speedKph: 38.5,
  headingDegrees: 120,
  accuracyMetres: 8,
    isMock: false,
};

describe('toPingBody', () => {
  /**
   * Mutation check — swap the two assignments in `toPingBody` and this fails.
   * Nothing else in the app would: 32.5825 is a valid latitude only in the
   * sense that the number is in range, and the vehicle appears in the Atlantic
   * off Ghana.
   */
  it('puts latitude in latitude and longitude in longitude', () => {
    const body = toPingBody(KAMPALA);

    expect(body.latitude).toBe(0.3476);
    expect(body.longitude).toBe(32.5825);
  });

  it('sends the device capture time, not an upload time', () => {
    expect(toPingBody(KAMPALA).recorded_at).toBe('2026-08-07T08:00:00.000Z');
  });

  it('passes the optional readings through as nulls rather than dropping them', () => {
    const body = toPingBody({
      ...KAMPALA,
      speedKph: null,
      headingDegrees: null,
      accuracyMetres: null,
    });

    expect(body).toHaveProperty('speed_kph', null);
    expect(body).toHaveProperty('heading_degrees', null);
    expect(body).toHaveProperty('accuracy_metres', null);
  });
});

describe('looksLikeServiceArea', () => {
  it('accepts a position in Uganda', () => {
    expect(looksLikeServiceArea({ lat: 0.3476, lng: 32.5825 })).toBe(true);
  });

  /** The swap this warning exists to catch, at the exact coordinates above. */
  it('rejects the same position with its fields swapped', () => {
    expect(looksLikeServiceArea({ lat: 32.5825, lng: 0.3476 })).toBe(false);
  });
});
