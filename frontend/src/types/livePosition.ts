/**
 * One vehicle's current position (ADR-0019), exactly as
 * `GET /live-positions` returns it.
 *
 * The endpoint is already scoped to trips the caller may see, and confined
 * to trips in an occupying status — so everything in this list is a vehicle
 * actually working, and nothing in it belongs to another client. The map
 * renders what it is given and does no filtering of its own.
 */
export interface LivePosition {
  vehicle_id: number
  trip_id: number
  driver_id: number | null
  latitude: number
  longitude: number
  /** Null when the device did not report one, which is not the same as zero. */
  speed_kph: number | null
  /** Compass degrees, 0 = north. Null when the device did not report one. */
  heading_degrees: number | null
  recorded_at: string
  /** From the **device** clock, not storage time (ADR-0019). */
  age_seconds: number
  /**
   * Computed server-side against `tracking.live_stale_after_seconds`.
   *
   * Deliberately trusted rather than recomputed from `age_seconds` here: the
   * threshold would then live in two places, and the day they disagreed the
   * map would be confidently wrong about the one thing this field exists to
   * say.
   */
  stale: boolean
}
