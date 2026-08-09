/**
 * Wire types, transcribed from `docs/api/openapi.yaml`.
 *
 * That file is authoritative (AGENTS.md: "Mobile apps are built against this
 * contract; drift between code and spec fails the build"). Nothing here is
 * invented, and fields the app does not use are still declared so a mismatch
 * shows up at the type level rather than as an undefined at runtime.
 */

export type TripStatus =
  | 'assigned'
  | 'rejected'
  | 'accepted'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'no_show'
  | 'passenger_onboard'
  | 'trip_started'
  | 'waiting'
  | 'trip_resumed'
  | 'trip_completed'
  | 'invoice_generated'
  | 'disputed'
  | 'closed'
  | 'cancelled';

export type Vehicle = {
  id: number;
  registration_number: string;
  make: string | null;
  model: string | null;
};

export type Driver = {
  id: number;
  name: string;
  phone: string | null;
};

export type Trip = {
  id: number;
  tenant_id: number;
  booking_id: number | null;
  vehicle_id: number | null;
  vehicle?: Vehicle | null;
  driver_id: number | null;
  driver?: Driver | null;
  origin: string;
  destination: string;
  status: TripStatus;
  /**
   * What is legal from this state — **not** what this user may do. The
   * distinction is the server's own (`TripResource`), and `driverActions` in
   * `src/trips/transitions.ts` is where the app deals with it.
   */
  allowed_transitions: TripStatus[];
  odometer_start: number | null;
  odometer_end: number | null;
  odometer_start_photo_url: string | null;
  odometer_end_photo_url: string | null;
  /** Decimal serialised as a string ("12.34") — a billing input, not a float. */
  distance_km: string | null;
  gps_distance_km: string | null;
  distance_variance_flagged: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TripEvent = {
  id: number;
  trip_id: number;
  from_status: TripStatus | null;
  to_status: TripStatus;
  user_id: number | null;
  notes: string | null;
  created_at: string | null;
};

export type User = {
  id: number;
  tenant_id: number | null;
  name: string;
  email: string;
  role: string;
  role_label: string;
  status: 'active' | 'suspended';
  is_active: boolean;
  mfa_enabled: boolean;
  must_enrol_mfa: boolean;
};

export type AvailabilityKind = 'leave' | 'sick' | 'rest' | 'training' | 'other';

export type AvailabilityBlock = {
  id: number;
  resource_type: 'driver' | 'vehicle';
  resource_id: number;
  kind: AvailabilityKind | 'maintenance' | 'inspection' | 'repair';
  status: 'requested' | 'approved' | 'declined';
  answered_at: string | null;
  answer_note: string | null;
  starts_at: string | null;
  ends_at: string | null;
  reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CursorMeta = { cursor: { next: string | null } };

/**
 * A position, in named fields.
 *
 * Never a positional pair. Uganda sits at ~0.3°N, ~32.6°E, so a swapped
 * latitude and longitude passes every range check either field could impose
 * and puts the vehicle in the Atlantic off Ghana. `docs/adr/0020` records this
 * codebase hitting that swap, and `ZoneBoundaryPoint` in the OpenAPI spec
 * carries the same warning. There is exactly one place in this app where these
 * become the wire's `latitude`/`longitude`: `toPingBody` in
 * `src/location/pings.ts`.
 */
export type Coordinates = {
  lat: number;
  lng: number;
};
