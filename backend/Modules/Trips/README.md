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
2. **Redis streams and live tracking** — ADR-0003's ingestion architecture
   is built (validate → buffer → batch worker → partitioned MySQL) but the
   buffer is Laravel's queue, which is Redis-backed in production via
   `QUEUE_CONNECTION=redis`. What is *not* built is the Redis **stream**
   specifically — `XADD`, consumer groups, replay after a crashed worker —
   and the live latest-position reads ADR-0003 says must come from Redis
   rather than MySQL, with the <15 s freshness PROJECT.md asks for. There
   is no live map. See "GPS route capture" below.
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
10. **No server-side filter by client on the trip list.** `TripResource`
    now carries `client` and `TripsPage` shows a Client column for a
    platform reader, but the filter box narrows only the page already
    fetched. A `tenant_id` query parameter is the fix, and it is the same
    gap `Modules/Bookings` records against its queue.
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

`trip_events` needs no `forActor()` of its own. `TripEventController` reads
`$trip->events()`, and by the time it runs the `subject-tenant` middleware
has bound the trip's own tenant — so the timeline is scoped to the client
whose trip it is, whoever is reading it.
