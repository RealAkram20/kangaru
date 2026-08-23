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
  /**
   * The fleet's own category vocabulary (ADR-0050) — `sedan`, `boda`,
   * `tricycle`, and whatever else the office has added since this build.
   *
   * A raw string rather than an enum, and deliberately: the rows are data in
   * a table an operator edits, so a value this bundle has never heard of is
   * the expected case rather than a fault. `spriteFor` in
   * `trips/vehicleSprites.ts` is where an unrecognised one lands, and it
   * lands on a generic car.
   *
   * **Already on the wire since before this field existed here.**
   * `VehicleResource` emits it, `TripController` eager-loads `vehicle`, and
   * `openapi.yaml` requires it — the driver app simply never declared it, so
   * it was arriving and being thrown away.
   */
  category: string | null;
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
 * One stop on a run — evidence, never a plan (ADR-0045 §1).
 *
 * The label is frozen at creation: renaming the client's saved place later
 * does not rewrite what this journey visited. Coordinates follow
 * `TripPlace`'s both-or-neither rule, and a label-only stop (typed free
 * text) renders as prose, never as a pin at 0°,0°.
 */
export type TripStop = {
  id: number;
  /** 1-based position on the run. Appended, never reordered (§7). */
  sequence: number;
  label: string;
  latitude: number | null;
  longitude: number | null;
  /** Who put it on the run. Only `added_by_driver` counts as unplanned. */
  source: 'planned' | 'added_by_driver' | 'added_by_dispatch' | 'added_by_client';
  /**
   * Moved only by the transitions §2 reuses: the pause that carries a
   * `stop_id` marks `arrived`, the resume marks `done`. `skipped` is §6's
   * case and no surface writes it yet.
   */
  status: 'pending' | 'arrived' | 'done' | 'skipped';
  arrived_at: string | null;
  departed_at: string | null;
  skip_reason: string | null;
  client_place_id: number | null;
};

/**
 * A saved place offered by the add-a-drop-off search (ADR-0045 §10) — a row
 * of the client's own register, released to the trip's driver while the run
 * is live and to nobody else.
 */
export type TripStopCandidate = {
  id: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

/**
 * A public-geocoder answer for a stop the register does not know (the §10
 * follow-up the owner decided 2026-08-22). Server-proxied — the handset never
 * talks to the geocoder — and always located: the server drops any feature
 * without a usable pair, because the pin is the whole value of a suggestion
 * over the free-text row.
 */
export type PlaceSuggestion = {
  name: string;
  detail: string | null;
  latitude: number;
  longitude: number;
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
 * What the driver showed and took at the kerb, while the settled fare waited
 * for the server to resolve the trip's distance (ADR-0045 §5).
 *
 * Priced at completion through the same engine as everything else, from the
 * distance this handset measured of its own buffered pings. **Null once the
 * fare has settled at the same figure** — there is nothing to distinguish —
 * and non-null beside a settled fare only when the two differ, which is a
 * fact the driver needs to see rather than a discrepancy to hide.
 */
export type ProvisionalFare = {
  total_minor: number;
  currency: string;
  /** What it was priced on, in kilometres. Null when the phone had nothing. */
  distance_km: number | null;
  is_estimate: true;
  is_provisional: true;
  basis: string;
};

/**
 * What the server made of this trip's distance (ADR-0045).
 *
 * `held` is the one field a screen must act on: a held trip has no settled
 * fare and no invoice until a person in the office reviews the evidence and
 * clears it.
 */
export type TripDistanceResolution = {
  billed_km: number | null;
  grade: 'A' | 'B' | 'C' | 'U';
  grade_label: string;
  resolved_at: string;
  held: boolean;
  cleared_at: string | null;
  cleared_reason: string | null;
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

/**
 * One movement in a driver's account (ADR-0029 §2) — a row of the wallet
 * statement, and a row of a trip's own money record.
 *
 * Hand-transcribed from `docs/api/openapi.yaml`, like every type in this file.
 *
 * Lived in `endpoints.ts` until `TripEarnings.lines` needed it; it is exported
 * from there still, so nothing that imports it had to change. **The kinds below
 * are the whole vocabulary** — a screen showing any other transaction type
 * would be inventing one.
 */
export type DriverLedgerEntry = {
  id: number;
  kind:
    | 'fare_earned'
    | 'cash_collected'
    | 'settlement'
    | 'adjustment'
    /**
     * The tip pair and the weekly bonus (ADR-0034).
     *
     * `tip_earned` is the driver's share **after commission** — the owner
     * ruled that the platform takes its usual cut of a tip, which is what
     * lets a tip reuse the pair a cash fare writes. `tip_cash_collected` is
     * the gross in their hand, and the net of the two is the commission now
     * owed.
     *
     * `bonus` is **unpaired**: it is not cash in anybody's hand, so the
     * balance moves by the whole amount.
     */
    | 'tip_earned'
    | 'tip_cash_collected'
    | 'bonus';
  /** The kind in words, from the server's own enum, so nothing re-spells them. */
  kind_label: string;
  /**
   * **Signed, and the sign is the meaning**: positive means the platform owes
   * the driver, negative means the driver owes the platform. Minor units —
   * UGX is zero-decimal, so whole shillings, and never divide.
   *
   * Direction must not be inferred from `kind`: `settlement` legitimately
   * runs both ways, which is why ADR-0029 §2 replaced a one-way `payout`.
   */
  amount_minor: number;
  currency: string;
  /**
   * Server-written prose, and load-bearing rather than decorative: ADR-0029
   * §3 records the commission rate in force *at completion* in this string,
   * which is what lets an old row show the rate that actually applied to it.
   */
  description: string;
  trip_id: number | null;
  /**
   * `ride`, `delivery` or `self_drive` — so a row can read "Ride earnings"
   * rather than the generic "Fare earned". Null on a settlement, and on a
   * walk-in a dispatcher fulfilled by hand; the app falls back to
   * `kind_label`, which is always true.
   */
  service_type: string | null;
  created_at: string | null;
};

/**
 * What the driver made on one completed trip.
 *
 * **`SettledFare` above is what the passenger paid; this is what is left of it
 * for the driver.** The two differ by the platform's cut, and conflating them
 * overstates a driver's income by the whole commission — which is why they are
 * two fields rather than one with a caveat in a docblock.
 *
 * Read back from the ADR-0029 ledger entry that recorded the credit, never
 * recomputed on the handset. `commission_minor` is `total_minor -
 * earned_minor`, derived server-side from the two figures actually written, so
 * it reports **the rate in force when the trip completed** rather than
 * whatever the office has set today. The percentage itself is deliberately not
 * in this payload: an app that displayed it would be stating a rule it does
 * not own and would go on stating the old one after the rate changed.
 */
export type TripEarnings = {
  /**
   * Every movement this trip made in the driver's wallet, oldest first — the
   * fare share, a confirmed tip (ADR-0034), a peak uplift (ADR-0036), a bonus,
   * and the cash counterpart on a cash job.
   *
   * **The same rows the wallet statement serves**, deliberately, so the trip
   * record renders them with `StatementRow` — the component that already
   * exists. A tip is worded here exactly as the same tip is worded in the
   * wallet, because two ways of writing one fact about somebody's pay is two
   * vocabularies to keep in step.
   *
   * **These are not the fare's components.** There is no base fare, distance
   * or waiting *amount* to be had after the fact: `TripPricingEngine` is pure
   * and writes nothing, so a walk-in stores a single total. A screen wanting
   * that breakdown is asking for a Billing feature, not a field.
   */
  lines: DriverLedgerEntry[];
  /** The driver's share, in minor units. UGX is zero-decimal — whole shillings. */
  earned_minor: number;
  /** The platform's cut. Derived as `total_minor - earned_minor`, not from a rate. */
  commission_minor: number;
  /** The gross fare, repeated so the three figures arrive as one object. */
  total_minor: number;
  currency: string;
  /** When the ledger credited it — not the instant the trip completed. */
  recorded_at: string | null;
};

/**
 * A road route between two points (ADR-0031).
 *
 * **Null is the ordinary answer**, not an error: no key configured, routing
 * switched off, no signal, a provider quota rejection, or a trip taken over
 * the phone with no coordinates. The map draws its dashed direct line in that
 * case, which is what it drew before routing existed.
 */
export type TripRoute = {
  /**
   * Google's encoded polyline, decoded by the map document rather than here.
   * An order of magnitude smaller than a point array on a handset's
   * connection, which is the whole reason it travels in this shape.
   */
  polyline: string;
  /** Road distance, not the crow's flight. */
  distance_km: number;
  /**
   * **Null unless the provider supplied one.** ADR-0031 §6 forbids deriving a
   * duration locally, whatever distance is in hand — that is the invention
   * ADR-0020 §3 refused, wearing a better number. Null means the screen shows
   * no minutes at all.
   */
  duration_seconds: number | null;
  provider: 'google' | 'osrm';
  /** A forecast, never a promise of arrival. Travels with the figure. */
  is_estimate: true;
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
  /**
   * The run's itinerary in order (ADR-0045) — an empty array on every
   * point-to-point trip. **Optional because it rides only on `GET
   * /trips/{id}`**, the same bound `payment` and `earnings` carry: list
   * endpoints do not load it, and `undefined` means "not asked", not "no
   * stops".
   */
  stops?: TripStop[];
  /**
   * How many stops were added mid-run rather than planned (§4). A note,
   * never a charge — the client sees the run deviated; nobody bills for it.
   */
  unplanned_stop_count: number;
  /**
   * `ride`, `delivery` or `self_drive` — what kind of job this was.
   *
   * Deliberately a loose `string`, like the ledger's field of the same name:
   * the server reads it from an enum this build cannot see, and a value added
   * next quarter must render as words rather than crash a record screen.
   * `serviceLabel` in `wallet/presentation.ts` is the one place it is named.
   *
   * **Null on every corporate trip**, which has a contract rather than an order
   * request, and null on the trips *list*, which does not load the relation.
   * Never default it to `ride`: that labels a parcel run a taxi fare.
   */
  service_type: string | null;
  /**
   * The reference the *customer* holds — `order_requests.reference`.
   *
   * The trip's `id` is the platform's identifier; this is the one printed on
   * the customer's confirmation and the one they read down the phone. The
   * record screen shows this where it exists and the trip number where it does
   * not, and says which of the two it is showing.
   *
   * Null on a corporate trip, and on the list.
   */
  reference: string | null;
  /**
   * What was carried, on a delivery — null on a ride.
   *
   * Null rather than an object of nulls, because the absence is the fact. The
   * same two allow-listed keys the offer card gets, from the same single reader
   * of `order_requests.details` — the column that also holds the two phone
   * numbers ADR-0024 §7 withholds.
   */
  package: OfferPackage | null;
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
   * The longest journey one closing odometer reading may describe, from
   * `tracking.odometer_max_km_per_trip` (ADR-0035).
   *
   * **Served rather than hardcoded, and that is the whole point.** The office
   * changes it in the console; a copy baked into this app would go on
   * enforcing the old number on handsets nobody can reach. It rides on the
   * trip because the trip is already cached offline, which is where a reading
   * gets typed.
   *
   * `OdometerScreen` uses it to refuse an impossible reading before queueing
   * it. **The server is still the control** — this app queues transitions
   * rather than sending them, so without it the refusal arrives as a parked
   * outbox item hours later.
   */
  odometer_max_km_per_trip: number;
  /**
   * How far a typed closing reading may sit from the distance this handset
   * measured before the app warns, from `tracking.variance_threshold_percent`
   * (ADR-0045 §5).
   *
   * Served for the same reason as the ceiling above and with the same caveat:
   * the office changes it, and the server measures the trace itself and
   * decides. This is a warning at the keypad, not a control.
   */
  variance_threshold_percent: number;
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
   * The kerb figure, while the settled one waits for the resolver
   * (ADR-0045 §5). Null when there is none, and null once it agrees with
   * `fare`.
   */
  provisional_fare: ProvisionalFare | null;
  /** What the server made of the distance, or null before it has run. */
  distance: TripDistanceResolution | null;
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
   * What this driver earned on it, and null far more often than it is set.
   *
   * Served to the trip's own driver alone — a dispatcher reading the board
   * gets null here, and so does a corporate client, who must never see the
   * platform's margin on their work. Null on the trips *list* too, which does
   * not load the ledger.
   *
   * **Null also means "not confirmed yet", which is the common case on the
   * completion screen.** Completion travels through the outbox, so the phone
   * usually arrives before the server has credited anything. `RideComplete`
   * renders an em dash and says so, then fills in when the flush lands.
   */
  earnings: TripEarnings | null;
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
  /**
   * **UTC**, and the only member to do arithmetic with — elapsed time, waiting
   * periods, the ordering of two transitions in one second.
   */
  created_at: string | null;
  /**
   * The same instant in the *fleet's* zone, rendered by the server.
   *
   * **Never derive a day or a clock reading from `created_at` on the handset.**
   * `config/app.php` is UTC, so a phone formatting it locally shows a Kampala
   * driver 05:30 where the server means 08:30 — and a phone that has picked up
   * a neighbouring country's zone shows a third answer. The trip record puts
   * these times beside a pickup address, where an hour out reads as a record of
   * a different journey.
   *
   * Same two keys, same reasoning, as `DriverTrip.local_day`/`local_time`.
   * `timeLabel` in `trips/history.ts` turns `HH:MM` into `08:30 AM` with pure
   * arithmetic — no `Intl`, whose data varies by Hermes build.
   */
  local_day: string | null;
  local_time: string | null;
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
