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

/**
 * A number to dial, and who answers it (ADR-0024 §7).
 *
 * `label` is not the same as `name` on purpose. Today they match, because
 * `DirectContactChannel` hands over the real number. Under a masking provider
 * the label would read "Passenger (via KangaruRide)", and a driver dialling a
 * proxy needs to be told so — otherwise they save it to their contacts as the
 * passenger's own number and ring it next week.
 */
export type ContactDetails = {
  name: string;
  phone: string;
  label: string;
};

export type Trip = {
  id: number;
  /** Null on a walk-in ride (ADR-0024 §1), which a customer owns instead. */
  tenant_id: number | null;
  customer_id: number | null;
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
  /**
   * Who to ring, and null far more often than not (ADR-0024 §7).
   *
   * The server withholds it unless this driver is the one on the trip, the
   * trip is a walk-in, and it is live — accepted through trip_completed. Not
   * before the accept, because a number given to a driver who then declines
   * is given away for nothing; not after a terminal status, because a
   * completed trip is not a directory.
   *
   * So the app renders a call button when this is present and simply does not
   * when it is absent. There is no rule to duplicate here.
   */
  passenger_contact: ContactDetails | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Whether this driver is waiting for work, and where (ADR-0024 §2).
 *
 * Distinct from the GPS the app streams during a trip: that is billing
 * evidence sampled for a route, this is a dispatch radius sampled for a
 * ranking, and running the fine-grained one all day is how a handset dies
 * before lunch.
 */
export type DriverPresence = {
  driver_id: number;
  on_duty: boolean;
  vehicle_id: number | null;
  latitude: number | null;
  longitude: number | null;
  recorded_at: string | null;
  /**
   * Whether the matcher would offer this driver work right now. Served by the
   * server rather than derived here, because the rule is three conditions and
   * a configured TTL — a copy would drift, and the symptom is the app telling
   * a driver they are online while the platform offers them nothing.
   */
  dispatchable: boolean;
  position_age_seconds: number | null;
  /** How often to report in. From config, so the cadence tunes without a release. */
  heartbeat_seconds: number;
};

export type OfferPlace = {
  label: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * A job in front of this driver, with a clock on it (ADR-0024 §3).
 *
 * Not a trip. Nothing exists in `trips` until the driver accepts — a trip in
 * `assigned` would occupy their vehicle for as long as they ignored the
 * phone. Accepting returns the Trip that was created.
 *
 * Carries no passenger name or number, deliberately: those are released only
 * after the accept, and this payload is also what a push notification is
 * built from, which puts it on a lock screen.
 */
export type DispatchOffer = {
  id: number;
  status: 'offered' | 'accepted' | 'declined' | 'expired' | 'superseded';
  expires_at: string;
  /**
   * Seconds left, as the *server* counted them at the moment it answered.
   *
   * Both this and `expires_at` are served, and the app prefers this one for
   * its first render: cheap Android hardware routinely has a clock minutes
   * out, and a countdown started from `expires_at` against a wrong local
   * clock shows a driver 40 seconds on a 15-second offer, or an offer that
   * has already expired.
   */
  expires_in_seconds: number;
  pickup: OfferPlace;
  dropoff: OfferPlace;
  service_type: string | null;
  reference: string | null;
  /** Straight-line, not road distance — a ranking, not a promised ETA. */
  pickup_distance_km: number | null;
  /** Why the matcher chose this driver, in sentences (ADR-0020 §4). */
  reasons: string[];
  vehicle_id: number | null;
  vehicle_registration?: string | null;
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
