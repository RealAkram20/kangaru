import type { Coordinates } from '../api/types';

/** One GPS reading, as the app carries it internally. */
export type Ping = {
  position: Coordinates;
  /**
   * The **device's** clock at capture, ISO-8601.
   *
   * `docs/driver-app-brief.md`: "send when it was captured, not when it was
   * uploaded." `TripRouteRecorder` writes this straight into `recorded_at`,
   * and `trip_locations` is partitioned by month — a ping captured upcountry
   * and synced the next day belongs to the month it was recorded in, which is
   * the month its trip is billed in.
   */
  recordedAt: string;
  speedKph: number | null;
  headingDegrees: number | null;
  accuracyMetres: number | null;
};

/** The wire shape from `docs/api/openapi.yaml`. */
export type PingBody = {
  latitude: number;
  longitude: number;
  recorded_at: string;
  speed_kph: number | null;
  heading_degrees: number | null;
  accuracy_metres: number | null;
};

/**
 * The one place a `{lat, lng}` becomes a `latitude`/`longitude` pair.
 *
 * Everything upstream of here carries coordinates in named fields, never as a
 * positional array, precisely so this function is the only thing that can get
 * the order wrong — and it is a single line under test. Uganda sits at ~0.3°N,
 * ~32.6°E, so a swap passes every range check either field could impose and
 * puts the vehicle in the Atlantic off Ghana. ADR-0020 records this codebase
 * hitting that swap, and the OpenAPI spec's `ZoneBoundaryPoint` carries the
 * same warning.
 */
export function toPingBody(ping: Ping): PingBody {
  return {
    latitude: ping.position.lat,
    longitude: ping.position.lng,
    recorded_at: ping.recordedAt,
    speed_kph: ping.speedKph,
    heading_degrees: ping.headingDegrees,
    accuracy_metres: ping.accuracyMetres,
  };
}

/**
 * The service area, generously bounded: Uganda is roughly 1.5°S–4.3°N and
 * 29.5°E–35.1°E, padded by a degree for cross-border work.
 */
const SERVICE_AREA = { minLat: -2.5, maxLat: 5.5, minLng: 28.5, maxLng: 36.5 };

/**
 * Whether a position is somewhere this fleet could plausibly be.
 *
 * Not a validator — it does not reject, and nothing calls it in a code path
 * that can drop a ping. A vehicle genuinely outside the region should still
 * report, and a client second-guessing the server's range checks is how real
 * data gets thrown away. It exists so a swap shows up as a loud warning in
 * development rather than as a marker in the sea three weeks later.
 */
export function looksLikeServiceArea(position: Coordinates): boolean {
  return (
    position.lat >= SERVICE_AREA.minLat &&
    position.lat <= SERVICE_AREA.maxLat &&
    position.lng >= SERVICE_AREA.minLng &&
    position.lng <= SERVICE_AREA.maxLng
  );
}

/**
 * The documented server maximum. A batch larger than this is refused whole,
 * which after a long offline stretch is precisely when the app can least
 * afford to lose one.
 */
export const MAX_PINGS_PER_REQUEST = 500;

/**
 * About 55 hours of driving at the 10-second cadence.
 *
 * A cap has to exist — a phone left on in a vehicle for a fortnight would
 * otherwise fill its storage — but a silent one reads as complete coverage.
 * `GpsPingBuffer` logs what it drops.
 */
export const MAX_BUFFERED_PINGS = 20_000;
