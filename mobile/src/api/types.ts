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

/**
 * One end of a journey, in prose and — where the platform has it — in
 * coordinates.
 *
 * `label` is always present; `trips.origin` and `trips.destination` are not
 * nullable. The coordinates come from the walk-in order behind the trip and
 * are null on every corporate trip, on any order a dispatcher keyed in over
 * the phone, and on any endpoint that did not load that relation.
 *
 * **Both or neither.** `located()` in `src/trips/places.ts` is the one place
 * that decides — a half-resolved position is not a place, and treating a
 * missing half as zero puts a Kampala vehicle in the Atlantic off Ghana. See
 * `Coordinates` below, which carries the same warning for the same reason.
 */
export type TripPlace = {
  label: string;
  latitude: number | null;
  longitude: number | null;
};

/**
 * A fare that was actually charged, as against `FareEstimate`, which is a
 * quote (ADR-0026 §2).
 *
 * `is_estimate` is `false` here and `true` there, carried in both payloads so
 * no screen has to infer which figure it holds from the key it arrived under.
 */
export type SettledFare = {
  total_minor: number;
  currency: string | null;
  /** What priced it, so the figure can be re-derived years later. */
  rate_card_version_id: number | null;
  computed_at: string | null;
  is_estimate: false;
};

/**
 * How a job settles, on a trip that has a walk-in order behind it.
 *
 * `payment_method` is a raw string rather than `OfferPaymentMethod`, and the
 * looser type is honest: the server reads it out of a JSON column filled by a
 * public form and casts it without checking it against an enum, so a value
 * this build has never seen is a real possibility. `tripPaymentLabel` in
 * `trips/progress.ts` is the one place that narrows it, and anything
 * unrecognised renders as an em dash rather than as a machine token.
 *
 * Both members are independently nullable: both keys are optional on the
 * order form, and **null must never be read as "cash"**.
 */
export type TripPayment = {
  payment_method: string | null;
  payer: string | null;
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
  /** The same two places, with coordinates where there are any. */
  pickup: TripPlace;
  dropoff: TripPlace;
  status: TripStatus;
  /**
   * What is legal from this state — **not** what this user may do. The
   * distinction is the server's own (`TripResource`), and `driverActions` in
   * `src/trips/transitions.ts` is where the app deals with it.
   */
  allowed_transitions: TripStatus[];
  /**
   * What `WaitingRing` fills against while a trip sits at `driver_arrived`,
   * from `dispatch.pickup_wait_target_seconds`.
   *
   * **A display target, and nothing expires when it passes.** Nothing on this
   * platform charges, bounds or ends a wait at the kerb: the rate card's
   * waiting rates bill the *in-trip* `waiting` status only, and a driver may
   * not post `no_show`. The ring saturates and holds; see `trips/waiting.ts`.
   */
  pickup_wait_target_seconds: number;
  /**
   * How this job settles, or null.
   *
   * **Null is a real answer**: a corporate trip is invoiced to the client and
   * has no per-trip settlement to collect. It is also null on any endpoint
   * that did not load the order behind the trip — every list view — so only
   * `GET /trips/{id}` carries it.
   */
  payment: TripPayment | null;
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
   * What was charged, once somebody drove it. Null until the trip completes
   * and null forever on a corporate trip, which is invoiced instead.
   */
  fare: SettledFare | null;
  /**
   * What it is expected to fetch, before that — the figure the driver
   * accepted the job on.
   *
   * Null once `fare` is set, so nothing shows an estimate beside a bill, and
   * **null on the trips *list*, which does not load what a quote needs.** Only
   * `GET /trips/{id}` carries it, which is what the pickup screen fetches.
   */
  estimated_fare: FareEstimate | null;
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

export type OfferPackageSize = 'small' | 'medium' | 'large' | 'heavy';

export type OfferItemType =
  | 'documents'
  | 'food'
  | 'parcel'
  | 'electronics'
  | 'furniture'
  | 'appliances'
  | 'other';

/**
 * What is being sent, on a delivery (ADR-0024 §3).
 *
 * Two fields, and the *absence* of the rest is the point. The server keeps an
 * allow-list over `order_requests.details`, which on a delivery also holds
 * `sender_phone` and `recipient_phone` — numbers ADR-0024 §7 withholds until
 * after the accept, and this payload is what a push notification is built
 * from. Nothing here should ever grow a contact field; if a screen needs one,
 * it needs the trip, not the offer.
 *
 * Either field is null when the person ordering did not say. That renders as
 * no figure rather than a guess.
 */
export type OfferPackage = {
  item_type: OfferItemType | null;
  package_size: OfferPackageSize | null;
};

export type OfferPaymentMethod = 'cash' | 'mobile_money' | 'card';

/** Which end of a delivery settles the bill. Null on a ride — there is one end. */
export type OfferPayer = 'sender' | 'receiver';

/**
 * How the job settles, and which end settles it (ADR-0024 §3).
 *
 * Allow-listed out of `order_requests.details` on the same terms as
 * `OfferPackage` — see that type for why nothing here may ever grow a contact
 * field. It is a decision input that identifies nobody: a driver carrying no
 * float declines a cash job, and on a parcel the person ordering is often not
 * the person paying.
 *
 * Present on every service, unlike `package`, because every job is paid for.
 * Both members are null whenever the person ordering did not say, which is
 * the common case — the public order form marks both optional.
 *
 * **Null is never rendered as "Cash".** It is the plausible default and the
 * wrong one: a driver who reads it, turns up with no float and is offered a
 * mobile-money transfer has been told something the platform never knew.
 */
export type OfferPayment = {
  payment_method: OfferPaymentMethod | null;
  payer: OfferPayer | null;
};

/**
 * What a job is estimated to fetch, before anybody drives it (ADR-0026 §2).
 *
 * A **fare**, not driver earnings, and the distinction is not pedantry: the
 * platform has no commission model and settlement is deferred (ADR-0026 §3),
 * so a screen that said "earnings" would be promising the whole figure — and
 * would become a lie in every already-installed build the day a platform cut
 * is introduced. `estimatedFareLabel` in `offerPresentation.ts` is the one
 * place that wording lives.
 */
export type FareEstimate = {
  vehicle_category: string;
  /** Great-circle kilometres. Under-reads against real roads, on purpose. */
  distance_km: number;
  /** Minor units. UGX is zero-decimal, so this is whole shillings. */
  total_minor: number;
  currency: string;
  /**
   * Always true. Carried in the payload rather than assumed by the client,
   * so no screen can render a quote as a bill by forgetting to say so.
   */
  is_estimate: boolean;
  basis: string;
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
  /**
   * How far the driver is from the pickup. Straight-line, not road distance
   * — a ranking, not a promised ETA.
   */
  pickup_distance_km: number | null;
  /**
   * How far the job itself runs, pickup to drop-off. The other half of the
   * same question, and the reason this screen shows two distances: 0.4 km
   * away is a good offer if the ride is 9 km and a poor one if it is 700 m.
   *
   * **Straight-line, and it must never be divided by an assumed speed to
   * produce an ETA.** ADR-0020 §3 declined to derive minutes from a straight
   * line by name — real roads are longer than the crow's flight, so this
   * under-reads, and the invented figure is the one that would have to be
   * defended to a driver who arrived late. Null when either end of the
   * journey has no coordinates, as an order taken over the phone has none.
   */
  trip_distance_km: number | null;
  /** Why the matcher chose this driver, in sentences (ADR-0020 §4). */
  reasons: string[];
  /** Null on anything that is not a delivery. */
  package: OfferPackage | null;
  /** Always an object; its members carry the not-known. See `OfferPayment`. */
  payment: OfferPayment;
  /** Null whenever no honest figure exists — see `FareEstimate`. */
  estimated_fare: FareEstimate | null;
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
