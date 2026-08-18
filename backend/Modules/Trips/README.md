# Trips

## Purpose

Delivers the Bank's six Phase-1 acceptance criteria: date/time of trip
start and completion, vehicle registration, trip origin and destination,
opening/closing odometer readings, total distance, and trip duration
(PROJECT.md). Governed by AGENTS.md's mandatory "Trip State Machine".

## Responsibilities

- `Trip` — the lifecycle record, created in `Assigned` status. Normally
  raised by `Modules/Dispatch` from a `Booking` (`trips.booking_id`);
  `booking_id` is nullable because `POST /api/v1/trips` still serves the
  ad-hoc case of a trip raised at the desk from a phone call.
- `TripAssignmentGuard` (`Modules/Trips/Services/TripAssignmentGuard.php`)
  — the single choke point for putting a vehicle and driver onto a trip,
  enforcing AGENTS.md's pessimistic-locking rule. All three assignment
  paths (ad-hoc creation, booking dispatch, reassignment out of `Rejected`)
  go through it. See `Modules/Dispatch/README.md` for why it lives here
  rather than in Dispatch, and for the mandated race test.
- `TripStatus` (`Modules/Trips/Enums/TripStatus.php`) — the full AGENTS.md
  lifecycle graph as an enum with an `allowedTransitions()` method. This
  is the single source of truth for the transition map.
- `TripStateMachine` (`Modules/Trips/Services/TripStateMachine.php`) — the
  only code path allowed to change `Trip::status` or the fields it gates
  (odometer, timestamps, distance). Validates the transition against
  `TripStatus::allowedTransitions()`, applies side effects, writes the
  `trip_events` row, all in one DB transaction. An illegal transition
  throws `InvalidTripTransitionException`, caught in `TripController` and
  returned as `409 INVALID_TRIP_TRANSITION`.
- `TripEvent` — append-only timeline (`trip_events` table, mirrors
  `App\Models\AuditLog`'s immutability pattern). Every transition is
  timestamped here; waiting-time billing is computed from these events,
  never from a mutable column, per AGENTS.md.
- `Trip` also uses `App\Concerns\Auditable` (generic before/after diff to
  `audit_logs`) *in addition to* `trip_events` — the two serve different
  purposes: `audit_logs` is compliance diffing (same as every other
  audited model), `trip_events` is the domain-specific lifecycle timeline.

## Dependencies

- `Modules\Vehicles\Models\Vehicle`, `Modules\Drivers\Models\Driver` —
  `trips.vehicle_id`/`driver_id` foreign keys, `restrictOnDelete` (trip
  history is audit-relevant and must not vanish if the vehicle/driver row
  is deleted).
- `Modules\Drivers\Models\Driver.user_id` — links a driver profile to the
  authenticated `User` who can trigger that driver's own trip transitions.
- `App\Concerns\BelongsToTenant`, `App\Support\Tenancy\TenantContext`.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode::INVALID_TRIP_TRANSITION`.

## Public APIs

All behind `auth:sanctum` + `tenant` middleware. No `PATCH`/`DELETE` —
every mutation to bank-required fields must go through a transition;
deleting a trip would break the audit trail, so it isn't exposed.

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/trips` | `viewAny` — cursor-paginated; a Driver sees only their own assigned trips |
| GET | `/api/v1/trips/{id}` | `view` — same tenant only; a Driver may only view their own trip |
| POST | `/api/v1/trips` | `create` — Super Admin, Operations Manager, Dispatcher, Fleet Owner, Branch Manager, Depot Manager |
| POST | `/api/v1/trips/{id}/transitions` | `transition` — role- and target-status-dependent, see `TripPolicy` |
| GET | `/api/v1/trips/{id}/events` | `view` (on the parent trip) — the append-only timeline, cursor-paginated |

### What `TripResource` serves beyond the columns

Additions the driver app reads, all on `show` — the first three for the pickup
screen, `earnings` for the completion screen:

**`pickup` and `dropoff`** repeat `origin`/`destination` with coordinates
attached. Those two string fields are unchanged and stay — AGENTS.md allows
additive changes within a version and no removals. The coordinates come from
the walk-in order behind the trip (`Trip::orderRequest()`, a `hasOne` against
the `order_requests.trip_id` the accept path already writes — there is no
column on `trips` and no migration). They are null on every corporate trip and
on anything a dispatcher keyed in over the phone.

**Latitude and longitude are served together or not at all.** Half a position
is not a place, and the tempting client-side fix for a missing half is `?? 0`
— which at Uganda's latitude is the Atlantic off Ghana, the same spot ADR-0020
records a latitude/longitude swap landing a vehicle.

**`fare` and `estimated_fare` are different claims and are different fields.**
`fare` is what `WalkInFareService::settle()` charged, with the rate card
version that priced it; `estimated_fare` is a quote from the public tariff
(ADR-0026 §2). `is_estimate` is `false` on one and `true` on the other, so no
client infers which it holds from the key it arrived under. The quote stops
the moment a real fare exists, so nothing shows an estimate beside a bill.

**`earnings` is what the *driver* made, and `fare` is what the passenger
paid.** They differ by the platform's cut, and conflating them overstates a
driver's income by the whole commission — which is why they are two fields.
The block carries `earned_minor`, `commission_minor`, `total_minor`,
`currency` and `recorded_at`, and every one of them is **read back from the
ADR-0029 ledger entry that recorded the credit** rather than recomputed:
`commission_minor` is `total_minor − earned_minor`, derived from the two
figures actually written. That is what makes it report the rate in force *when
the trip completed*, however `billing.driver_commission_percent` has moved
since — ADR-0029 §3 forbids restating what a driver already earned. The
percentage itself is deliberately not served: a client that displayed it would
be stating a rule it does not own.

**It is served to the trip's own driver and to nobody else**, keyed off
`driver->user_id` exactly as `passenger_contact` is. A dispatcher holding
`trips.view.all` sees the board but not what a driver takes home, and a
corporate client must never read the platform's margin on their work. It is
null on every corporate trip (no `fare_minor`, so ADR-0029 §4 raises no ledger
pair) and null in the window between a completion arriving and the listener
crediting it — which the driver app renders as "not confirmed yet" rather than
as a zero. `TripEarningsTest` covers all seven cases.

**`estimated_fare` and `earnings` are both bounded to `show` on purpose.** A quote costs two or
three queries through `RateCardResolver`, and this resource also renders
`GET /trips` — an unbounded quote would be a query per row on a dispatch
board. The controller eager-loads `orderRequest` and `ledgerEntries` on `show`
and neither on `index`, and both fields follow — an unloaded relation yields
null rather than a lazy query.
`TripPlacesAndFareTest` and `TripEarningsTest` assert both halves. If a list
ever genuinely needs the figure, memoise the tariff version per request inside
Billing rather than removing this guard — and note that making
`RateCardResolver` `scoped` is not free, because a version held across an
invoice run could be a stale one.

## Trip lifecycle

```
Assigned --> Rejected --> Assigned (reassign) / Cancelled
Assigned --> Accepted --> Driver En Route --> Driver Arrived
    --> No Show (terminal, billing per rate card deferred)
    --> Passenger Onboard
         --> Trip Started (odometer opening captured)
              --> Waiting <--> Trip Resumed
              --> Trip Completed (odometer closing captured, distance computed)
                   --> Invoice Generated --> Disputed --> Closed
                                          --> Closed
Cancelled: reachable from any state before Trip Started, including Rejected
```

## What's explicitly deferred

1. **Enforcing that a photo is captured** — the photo is optional. A camera
   that will not focus in the dark at the start of an upcountry run must
   not be able to strand a trip: the reading is one of the Bank's six
   acceptance criteria and the photo supports it. Trips missing one are
   not currently reported anywhere either — the trip report's completeness
   figure counts the six criteria, not photos.
2. **~~Live latest-position reads~~ — built, ADR-0019 (7 August 2026).**
   `GET /api/v1/live-positions` answers "where is the fleet right now" from
   a `live_positions` snapshot — one row per vehicle, upserted newest-wins
   on every ping — so it never touches `trip_locations`, the table expected
   to reach ~500M rows a year. Each entry carries `age_seconds` from the
   *device* clock and a server-computed `stale` flag, so ingestion lag is
   visible rather than hidden.

   Visibility is resolved through `Trip::forActor()` and the
   `trips.view.all` predicate, never by filtering the positions table — two
   copies of that predicate drifting apart would show one client another
   client's van moving.

   The history is written **before** the snapshot and a live-store failure
   is logged and swallowed: the route is evidence, and a live-map dependency
   that could fail a ping batch would duplicate route through the job's
   retry.

   `LivePositionStore` has a Redis driver (hash per vehicle + TTL + an index
   set, as ADR-0003 intended) and a database driver. **The database one is
   the default**, because this environment has no Redis server, extension or
   client — so the Redis driver is written and has never been run, and
   defaulting to an unexercised path is shipping a guess.

   **Redis *stream* ingestion remains unbuilt** — `XADD`, consumer groups,
   replay after a crashed worker. The write path still buffers on Laravel's
   queue. Building a stream worker never once run against a real Redis would
   be worse than not building it: the failure modes it exists to handle are
   exactly the ones that cannot be reasoned into correctness. That work
   needs Redis in the development environment first, which is a
   prerequisite rather than an excuse.

   **~~Still no frontend map~~ — built, 7 August 2026** (ADR-0019 §
   "The map itself"). `/live-map` in the console polls this endpoint every
   ten seconds, pauses entirely while the tab is hidden, and refreshes at
   once on return. It filters nothing: the scoping above is the whole of
   it, so a corporate employee sees their own ride and a dispatcher sees the
   fleet.

   Two properties of that page are worth knowing before changing it.
   Markers are **moved, never rebuilt** — rebuilding makes every vehicle
   blink on each poll and closes any popup under the dispatcher's hand. And
   a failed refresh **keeps the markers on screen**, because a dropped
   request is not evidence the fleet vanished, and a blanked map reads as
   "everything stopped". Both are mutation-tested in
   `frontend/src/lib/livePositions.test.ts` and
   `frontend/src/pages/LiveMapPage.test.tsx`.
3. **Rate-card-driven cancellation/no-show charges** — `cancellation_charge_applicable`
   is a manual boolean flag only, no computed amount. No-show has no
   charge flag at all yet. `Modules/Billing` doesn't exist yet.
4. **Scheduled/timed No Show detection** — "after a configurable wait" is
   a manual, human-triggered transition only; no background job watches
   `Driver Arrived` duration.
5. **Automatic dispatch** — the booking → approval → assignment pipeline
   now exists (`Modules/Bookings`, `Modules/Dispatch`), but assignment is
   manual: a dispatcher names the vehicle and driver. Suggesting them is
   deferred by PROJECT.md until there is data to tune it.
6. **`?include=` expansion** — not implemented; `vehicle`/`driver` are
   always eager-loaded and nested on `TripResource` instead.
7. **Offline-resilient trip capture** (AGENTS.md "Offline resilience") —
   Phase 1 here is an online-only API; local-capture-and-sync is a later
   frontend pass.
8. **Creating a trip from the UI** — `TripsPage` lists trips, shows the
   timeline, and drives every transition (including odometer capture), but
   there is no ad-hoc "new trip" form. Trips are raised from the dispatch
   board; `POST /api/v1/trips` is currently API-only.
9. **`Modules/Drivers` `user_id` linkage** — the column exists but has no
   request-layer/UI support in `Modules/Drivers` yet; populated only via
   direct Eloquent, seeders, or tests for now (see `Modules/Drivers/README.md`).
10. **No date filter on the trip list.** `?q=` covers route, registration,
    driver, status and client; `?status=`, `?vehicle_id=` and `?driver_id=`
    cover the rest. "Every trip in March" is still not expressible here —
    the trip *report* answers it, the list does not.
11. **`TripResource` sends three fields the frontend type does not
    declare** — `booking_id`, `odometer_start_photo_url` and
    `odometer_end_photo_url`. Nothing in the UI reads them, so this is
    unused surface rather than a bug, but `tsc -b` rejects any fixture
    that includes them while `tsc --noEmit` accepts it. Either the type
    catches up or the resource stops sending what nobody reads; both are
    decisions, neither is taken.

## Odometer photos

PROJECT.md's anchor-client requirement is "driver-entered value plus a
dashboard photo". The reading alone is a number somebody typed; the photo
is what makes it checkable.

A photo rides on the same transition as the reading it belongs to —
`POST /trips/{trip}/transitions` accepts `odometer_photo` as multipart on
`trip_started` and `trip_completed`. Keeping them in one request is the
point: a reading that can be submitted now and evidenced later has a window
in which it is unverifiable.

It is stored **before** the database transaction opens and deleted again if
that transaction rolls back. A file write is not transactional, and holding
a row lock for the length of a mobile upload to object storage would be
worse than the orphan it avoids. `OdometerPhotoTest` covers the rollback
case.

Paths are tenant-prefixed per ADR-0001
(`tenants/{tenant}/trips/{trip}/odometer/{start|end}-{uuid}.jpg`), and the
uuid means a retake never silently overwrites what is already on the
record.

`GET /trips/{trip}/odometer-photo/{start|end}` streams it back through the
API rather than exposing a storage URL. The photo shows a client's vehicle
at a known place and time; a public object-storage link would be
addressable by anyone who ever saw it, forever.

## GPS route capture (ADR-0003)

`POST /api/v1/trips/{trip}/locations` takes a batch of pings, validates
them, and queues them. It answers **202, not 201**: the pings are accepted
and buffered, nothing is written yet, and claiming 201 would assert a row
that does not exist.

`GET /api/v1/trips/{trip}/locations` serves the recorded route for replay,
cursor-paginated, with the measured distance in `meta.gps_distance_km`.

Only the trip's own driver and the dispatch roles may record locations.
**Finance cannot** — the route is the evidence for the distance a client is
billed, and the party doing the billing must not be able to write it.

### The table

`trip_locations` is partitioned by month from day one, as PROJECT.md
requires: it is the platform's growth risk at roughly 500M rows a year, and
retiring a month has to be a `DROP PARTITION` rather than a `DELETE` of
tens of millions of rows contending with live ingestion.

Three things about it are forced by the storage engine, not chosen:

- **No foreign keys.** InnoDB refuses them on a partitioned table — the
  server answers `ERROR 1506` — so this is the one justified exception to
  AGENTS.md's "proper foreign keys" rule in this schema. It also means
  `TenantScope` is the *only* thing separating one client's vehicle
  movements from another's, which is why
  `TripLocationCrossTenantIsolationTest` exists separately from the Trips
  one.
- **The primary key is `(id, recorded_at)`.** Every unique key on a
  partitioned table must contain every partitioning column.
- **`recorded_at` is DATETIME, not TIMESTAMP.** A TIMESTAMP can only be
  range-partitioned through `UNIX_TIMESTAMP()`.

`recorded_at` is the *device's* clock. A ping captured in an upcountry dead
zone and synced an hour later belongs to the month it happened in — which
is the month its trip is billed in, and the partition it must land in.

A `p_future` MAXVALUE partition always exists, so ingestion never fails
because maintenance did not run. `php artisan trip-locations:maintain`
carves months out of it ahead of time and drops whatever is past the
12-month retention.

### Distance, and why it is not just Haversine

`RouteDistanceCalculator` sums great-circle hops between consecutive
points, but **ignores segments below a noise floor** (default 5 m). A
parked vehicle still pings, and consumer GPS wanders several metres while
it does; over a 20-minute wait at ADR-0003's 10-second cadence that jitter
sums to a few hundred metres the vehicle never travelled — added to a
billed distance, on the very figure meant to catch a wrong odometer
reading. A test lays 120 stationary pings and asserts the answer is zero.

It returns **null, not zero**, for a trip with fewer than two points. The
two are different claims — "there is no GPS evidence" versus "the vehicle
did not move" — and reconciliation treats them differently.

### The odometer has both a floor and a ceiling (ADR-0035)

`TransitionTripRequest` refuses two readings outright, with 422, before the
trip moves:

- a closing reading **below** the opening one;
- a closing reading that makes the journey longer than
  `tracking.odometer_max_km_per_trip` (default 2,000 km).

Refused rather than flagged, and refused there rather than downstream: past it
the reading becomes a trip, then a fare, then a ledger entry or an invoice
line, and correcting it means somebody unpicking money. One closing reading of
100005 against an opening of 10001 recorded a 90,004 km journey and priced it
at UGX 198,013,800.

**The driver app does not see the refusal immediately.** It queues transitions
through the offline outbox (ADR-0023), so the 422 lands on a later drain and
*parks* the item with the server's message, which the sync queue screen shows.
That is ADR-0023 §6 working, and it still stops the fare — but it is why the
message names both the figure and the limit: it has to be legible hours later,
away from the dashboard. A console user sees it synchronously.

The two can never both fire — a reading below the opening one makes the
distance negative, which cannot exceed a positive ceiling — so no guard
enforces that. A first draft had one; a mutation pass proved it was dead code.

The ceiling is settings, not config: it is a fact about a fleet, not about this
codebase. An operator running cross-border work raises it; one running city
work only can drop it a long way and catch far more.

### Odometer reconciliation

At `Trip Completed`, the odometer span the driver just entered is compared
against the route. Beyond `tracking.variance_threshold_percent` (default
10%) the trip is flagged for review.

A trip with **no** GPS trace is left unflagged. Flagging it would flag
every trip taken before a tracker was fitted and bury the real ones —
PROJECT.md's success metric asks for flagged trips to be reviewed within
two business days, which only survives if the flag stays rare and means one
thing.

The threshold is deliberately loose for a first pass: GPS traces are noisy,
and a flag nobody trusts is a flag nobody reviews.

### Reconciliation depends on a running queue worker — and fails silently

**All of the above does nothing unless `php artisan queue:work` is running.**

Ingestion is asynchronous by design (ADR-0003): the endpoint answers 202 and
queues `RecordTripLocations`. With no worker, the job never runs,
`trip_locations` stays empty, `RouteDistanceCalculator::kilometresFor()`
returns null for want of two points, and `reconcileAgainstGps()` takes its
early return. `gps_distance_km` stays null and `distance_variance_flagged`
stays false.

That combination is indistinguishable from the legitimate "no GPS evidence"
case documented just above — which is exactly what makes it dangerous. Every
layer reports success. The app uploads, the API accepts, no exception is
raised, and the only symptom is evidence that never arrives.

This happened. The queue held unprocessed `RecordTripLocations` jobs while
`trip_locations` held 7 rows; draining it produced 726 and immediately flagged
two trips whose odometer readings disagreed with their traces by 96% and 54%.
In the meantime an odometer typo of one extra digit had priced a trip at
UGX 198,013,800 and written it to the driver ledger unflagged.

Until queue health is visible on a dashboard (proposed in
`docs/distance-and-fare-integrity-plan.md`, Phase 5), treat a null
`gps_distance_km` on a trip that *should* have a trace as a worker problem
until proven otherwise:

```bash
php artisan tinker --execute="echo DB::table('jobs')->count();"
```

### Measured distance (ADR-0045)

`Modules/Trips/Distance/` is the pipeline `docs/measured-distance-plan.md`
describes: the fare's distance from the **measured trace**, checked against a
**road-routed reference**, with the **odometer as a backup witness**. It runs
on every completed trip, and since Phase 2 the fare is priced from its figure
— `TripPricingEngine` reads `billed_distance_km ?? distance_km`.

**No fare moves until a rate card version asks it to.**
`rate_card_versions.distance_policy` defaults to `odometer`, under which the
resolver's figure *is* the odometer delta. Issuing a version that says
`gps_primary` is the flip, and it is a dated, reversible commercial act
rather than a deploy.

What runs, per completed trip, in `ResolveTripDistance` after
`tracking.resolution_grace_seconds` (and again whenever pings land for a trip
that has already completed — `DistanceResolutionScheduler`, from the
`TripCompleted` listener and from `RecordTripLocations`):

| Step | Class | Does |
|---|---|---|
| load | `TraceLoader` | the trip's pings as `TracePoint`s, in order, scope-free |
| clean | `TraceCleaner` | drops mock, poor-accuracy, duplicate-second, teleport and jitter pings; keeps every non-mock timestamp as *presence* |
| measure | `TraceMeasurer` + `MeasurementRouter` | splits into runs at silences, snaps each run to roads in ≤100-point chunks (OSRM `match`), routes across gaps; `gpsKm = matchedKm + inferredKm`, coverage, inferred share |
| reference | `RouteReference` | the road from the order's pins, or the trace's own ends |
| decide | `DistanceResolver` | pure: `(billedKm, grade A/B/C, reason)` from `DistanceWitnesses` + `DistancePolicy` + `DistanceThresholds` |
| record | `DistanceResolutionService` | one `trip_distance_evidence` row (append-only) + `trips.billed_distance_km / distance_grade / distance_resolved_at`; raises `TripDistanceResolved`, which is what settles a walk-in fare and credits the driver |

**The engine is OSRM and the switch is `tracking.trace_matching_enabled`
(default false)** — a separate seam from the map's `RouteProvider`, so the
per-trip path can never resolve to a metered vendor. Off, the measurer falls
back to haversine with everything counted as inferred, and with no reference
route every trip is grade C: that is the honest state of a deployment that
has not pointed `maps.osrm_base_url` at its own box yet, and it is what the
shadow data will show until it does.

**Coverage is skew-tolerant.** `started_at` is the server's clock and pings
are the handset's; coverage is the presence span less its internal gaps over
the longer of that span and the trip's duration, so a clock offset is not a
dead zone but a trace that started late still loses coverage.

`php artisan trips:replay-distance {trip} [--policy=] [--commit]` prints every
witness and the decision for a trip from stored data under today's
thresholds, and writes nothing unless told to. It is the tool for arguing
with a fare. Without `--policy` it uses the trip's own rate card's.

**Four grades, and the fourth is the one to understand.** A verified, B
bounded, C held — and **U unverified**: no usable trace *and* no reference
route, so nothing vouches for the odometer and nothing contradicts it. C is
held under every policy; U only under a trace-priced one, because there the
contract asked to be billed on something that was not measured. Under
`odometer` a U trip bills exactly as it always did — ADR-0035's "missing
evidence is not a discrepancy", carried into the gate. `Modules\Billing\
Pricing\DistanceGate` is where that is decided, for both billing paths.

**Endpoints (ADR-0045 §2):** `GET /trips/{trip}/distance` serves every
resolution of a trip, newest first — the console's evidence panel.
`POST /trips/{trip}/distance/clearance` lifts a hold with a reason: finance's
act (`trips.transition.finance`), audited, idempotent, and it does not change
the figure. `GET /trips/distance-review` is the queue of trips waiting on
that decision — oldest first, no filters, `viewAny` on Trip so an operations
user can watch the backlog even though clearing one is finance's act.

`HeldTripRepository` answers "held" from `trip_distance_evidence.policy` —
the policy the resolution ran under — rather than resolving a rate card per
row, which would be `RateCardResolver` reimplemented in SQL. Grade C is held
under every policy; grade U only under a trace-priced one. The one case this
can disagree with `DistanceGate` is a card whose policy changed after a trip
resolved and before it was billed; re-resolving corrects it, and the gate is
still the authority when money moves.

Every threshold is in the `tracking` settings group and every evidence row
records the thresholds *as applied*. `distance_km`, `gps_distance_km` and
`distance_variance_flagged` are untouched and mean what the sections above
say — the odometer is still captured, photographed, bounded at the transition
and kept as the fleet's mileage record.

**The kerb (ADR-0045 §5).** A walk-in fare now settles on
`TripDistanceResolved`, not `TripCompleted` — so `PriceProvisionalWalkInFare`
prices a **provisional** fare at completion from
`trips.provisional_distance_km` (what the handset measured of its own
buffered pings, sent with the completion) or the odometer delta. That figure
is what the driver shows and takes, is never overwritten, and is what the
driver's ledger records as `cash_collected`; `fare_earned` is the commission
share of the settled fare, so a difference between the two shows on the
driver's balance instead of being asserted away. Tests: `tests/Unit/Distance/*` (the rule and the bookkeeping, pure, with
a mutation pass on record in `docs/agent-worklog.md`),
`tests/Feature/Trips/OsrmMeasurementRouterTest.php` (the engine's HTTP,
faked), `tests/Feature/Trips/DistanceResolutionTest.php` (the pipeline end
to end).

## Frontend

`frontend/src/pages/TripsPage.tsx` — the list, the six bank facts, the
event timeline, and the transition actions;
`frontend/src/pages/trips/TransitionDialog.tsx` collects odometer readings
and reasons.

The action buttons are driven by `allowed_transitions` on `TripResource`,
which the API derives from `TripStatus::allowedTransitions()`. The client
therefore holds **no copy of the lifecycle graph** and cannot drift from
it — AGENTS.md's "allowed transitions are defined in one place" holds
across the stack, not just inside PHP. That field answers what the *state*
permits; `TripPolicy` still authorises who may do it.

## Notes

`TripCrossTenantIsolationTest` in `tests/Feature/Trips/` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds for
this resource (including `trip_events`), mirroring
`CompanyCrossTenantIsolationTest`. `TripStateMachineTest` exercises the
full transition graph, including illegal-transition 409s and odometer/
distance side effects.

Since ADR-0006 it has a **mirror**, in
`tests/Feature/Tenancy/PlatformStaffIsolationTest.php`: the first proves a
client sees only their own, the second proves a *platform* account with no
permission on a surface sees nothing of it either. Both are needed and they
fail differently — without the first one client reads another's data;
without the second, belonging to no tenant quietly becomes a permission of
its own.

**`?q=` searches vehicle registration and driver name as well as the
route** — `whereHas` rather than a join, so a trip cannot appear twice when
both match. A dispatcher reaches for a number plate far more often than for
an origin, which is why those two are in the search at all. See
`Modules/Bookings` for the wildcard-escaping and OR-nesting notes; the same
two traps apply here and the same helper handles them.

`trip_events` needs no `forActor()` of its own. `TripEventController` reads
`$trip->events()`, and by the time it runs the `subject-tenant` middleware
has bound the trip's own tenant — so the timeline is scoped to the client
whose trip it is, whoever is reading it.
