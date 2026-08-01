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

1. **Photo upload for odometer readings** — `odometer_start_photo_path`/
   `odometer_end_photo_path` columns exist, nullable, always null; no
   upload endpoint or storage wiring yet.
2. **Real GPS distance reconciliation** — `gps_distance_km` and
   `distance_variance_flagged` columns exist; population/comparison logic
   is a no-op until the ADR-0003 Redis/`trip_locations` pipeline exists.
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
