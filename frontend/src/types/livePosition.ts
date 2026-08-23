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
  /**
   * Who the marker is. Allow-listed server-side — plate, make, model, a
   * driver's name; no VIN, phone or licence number. Optional so a response
   * from an API older than the fields still types; the page then falls
   * back to "Vehicle #id".
   */
  vehicle?: LiveMapVehicle | null
  driver?: LiveMapDriver | null
  /**
   * The occupying trip the position was read through. Carries no
   * passenger on purpose: ADR-0024 §7 governs who sees a rider's name, and
   * the trip record behind "Open trip" is where it lives.
   */
  trip?: {
    id: number
    status: string
    origin: string | null
    destination: string | null
    /** Null on a walk-in (ADR-0024 §1) — Shanitah's own ride. */
    client: { id: number; name: string } | null
  } | null
}

export interface LiveMapVehicle {
  id: number
  registration_number: string
  make: string | null
  model: string | null
  /**
   * The platform's vehicle category ('boda', 'sedan', …) — what picks the
   * silhouette the map draws. Optional so a response from an API older
   * than the field still types; the map then falls back to the default
   * silhouette.
   */
  category?: string | null
}

export interface LiveMapDriver {
  id: number
  name: string
}

/**
 * One on-duty driver, as `GET /driver-presence` returns them (ADR-0024 §2,
 * the office's read). Shaped like `LivePosition` on purpose — `age_seconds`
 * and `stale` mean the same in both — so the page can merge the two lists.
 *
 * Platform staff only. A corporate client's console never asks for it: the
 * riders are Shanitah's, and the fleet register's read (`drivers.view`) is
 * what gates it.
 */
export interface OnDutyDriver {
  driver_id: number
  driver: LiveMapDriver | null
  vehicle_id: number | null
  vehicle: LiveMapVehicle | null
  /** Null, not zero, when the handset has never reported. */
  latitude: number | null
  longitude: number | null
  accuracy_metres: number | null
  recorded_at: string | null
  /** Null when never reported, like `recorded_at`. */
  age_seconds: number | null
  /** Older than the presence TTL, or never reported. */
  stale: boolean
  /** The occupying trip that has them, or null when they are waiting for work. */
  trip: { id: number; status: string } | null
}

/**
 * One available vehicle near a point, as `GET /public/nearby-vehicles`
 * returns it — the real fleet behind the order page's ambient vehicles and
 * the client live map's capacity view.
 *
 * Anonymized by design: a position and a silhouette. `key` is an opaque
 * marker id that is stable within the hour (so markers glide between
 * polls) and rotates across hours (so polling all day follows nobody).
 * Nothing in here joins back to the fleet register.
 */
export interface NearbyVehicle {
  key: string
  /** The platform's vehicle category; null when none is on record. */
  category: string | null
  /** Which sprite family a map should draw. */
  kind: 'sedan' | 'suv' | 'pickup' | 'boda'
  latitude: number
  longitude: number
  age_seconds: number | null
}
