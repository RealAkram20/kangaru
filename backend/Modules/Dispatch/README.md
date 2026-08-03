# Dispatch

## Purpose

Turns a Booking into an Assigned Trip by putting a specific vehicle and
driver on it. Manual and hybrid dispatch only — PROJECT.md explicitly defers
automatic dispatch optimization until there is data to tune it.

This module exists to hold one guarantee: **two dispatchers must never both
succeed in assigning the same vehicle to overlapping trips** (AGENTS.md,
"Concurrency (Dispatch)").

## Responsibilities

- `DispatchService::assign()` — the whole hand-over in one transaction:
  lock and re-read the booking, create the Trip through
  `Modules\Trips\Services\TripService`, then mark the booking `Assigned`.
  All three must succeed together. A booking marked `Assigned` with no trip
  would vanish from the dispatch queue with nobody driving it; a trip whose
  booking is still pending would invite a second dispatcher to assign it
  again.
- `DispatchController` — translates the three ways this can conflict into
  distinct `409` codes (`VEHICLE_UNAVAILABLE`, `DRIVER_UNAVAILABLE`,
  `INVALID_BOOKING_TRANSITION`) so clients can branch on `code` rather than
  parse a message.

## Where the lock actually lives

`Modules\Trips\Services\TripAssignmentGuard`, not here.

The invariant is a question about the `trips` table, and there are three
paths that put a vehicle and driver onto a trip:

1. `POST /api/v1/bookings/{id}/assignment` — this module.
2. `POST /api/v1/trips` — an ad-hoc trip raised at the desk with no prior
   booking (a phone call), owned by `Modules/Trips`.
3. `POST /api/v1/trips/{id}/transitions` with `to=assigned` — reassignment
   out of `Rejected`, owned by `Modules/Trips`.

All three go through the same guard. A second, unguarded assignment path
would silently void the guarantee, so there is exactly one — and it sits in
`Modules/Trips`, because putting it here would make Trips depend on
Dispatch, which already depends on Trips.

The guard locks the **vehicle and driver rows**, not the trips. Two
dispatchers racing on a free vehicle both find zero conflicting trips, so
locking only what already exists would let both through; the vehicle and
driver rows are the contended resource and are always present. Locks are
taken in a fixed order (vehicles, then drivers) so two overlapping
assignments cannot deadlock against each other.

Occupancy is defined by `TripStatus::occupiesVehicle()` — it ends at
`Trip Completed`, since the vehicle is physically free the moment the
passenger is dropped, even though `Invoice Generated` / `Disputed` /
`Closed` still follow on the billing side.

## Dependencies

- `Modules\Bookings\Models\Booking`, `Modules\Bookings\Enums\BookingStatus`,
  `Modules\Bookings\Services\InvalidBookingTransitionException`.
- `Modules\Trips\Services\TripService` and its
  `VehicleUnavailableException` / `DriverUnavailableException`.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode`.

Nothing depends on this module — it is the top of the dependency chain.

## Public APIs

| Method | Path | Policy |
|---|---|---|
| POST | `/api/v1/bookings/{id}/assignment` | `dispatch` on `BookingPolicy` — Super Admin, Operations Manager, Dispatcher, Fleet Owner, Branch Manager, Depot Manager |
| GET | `/api/v1/bookings/{id}/candidate-vehicles` | the same `dispatch` ability — a candidate list is a preview of the act |

Returns `201` with the created Trip. A Corporate Admin may raise and approve
bookings but never dispatch the fleet, so `dispatch` mirrors
`TripPolicy::create` rather than the Bookings desk roles.

### What an allocation does to a dispatch (ADR-0009)

Since ADR-0009 the pool is no longer flat. For a booking belonging to
client T, on the trip's date:

- A vehicle **contracted to T** ranks first and needs no explanation.
- A vehicle contracted to T that is **passed over** requires
  `allocation_override_reason`; without it the assignment is `422` against
  that field. The reason is stored on `trips.allocation_override_reason`
  and logged as `vehicle.dispatched_off_allocation`.
- A vehicle contracted **exclusively to somebody else** is refused with
  `409 VEHICLE_EXCLUSIVELY_ALLOCATED`. There is no override.
- A client with nothing contracted that day owes no reason for anything —
  otherwise a required field appears on every dispatch and becomes one
  everybody types "n/a" into.

`GET /bookings/{id}/candidate-vehicles` answers all of that up front:
active vehicles, contracted first, each carrying `allocated`,
`dispatchable`, `requires_override_reason` and a short `note`. Blocked
vehicles are listed and flagged rather than hidden, and no note names the
other client.

Both surfaces resolve their verdicts through `Modules\Fleet`'s
`AllocationLookup`, and a test dispatches **every** vehicle in the pool to
assert the list's promise matches the assignment's behaviour. Two
implementations of one rule drift silently, and the symptom would be a
board offering a vehicle that dispatch then refuses.

**The allocation reads sit after the vehicle and driver locks, deliberately.**
InnoDB fixes a transaction's consistent-read snapshot at its first plain
SELECT; running these lookups before `TripAssignmentGuard` acquired its
locks let a losing dispatcher judge availability from a pre-lock snapshot,
and both assignments won. `DispatchRaceTest` caught it. Anything added to
`applyAllocationRules` must stay on the far side of those locks.

`AssignBookingRequest` proves the vehicle and driver exist, are active, and
belong to the caller's tenant. Whether they are *free right now* is
deliberately not validated there — that is race-sensitive and only has a
trustworthy answer inside the locked transaction, which answers it with a
409.

## What's explicitly deferred

1. **Automatic dispatch** — moved *into* Phase 1 by owner approval on
   2 August 2026 (PROJECT.md), and still not built. `DispatchService` takes
   the vehicle and driver as arguments; nothing suggests them. ADR-0006
   unblocks it rather than delivering it: the cross-client queue a matcher
   needs now exists. The availability half remains buildable; the distance
   half still waits on ADR-0003's live positions, and a dispatcher that
   cannot tell which driver is nearest is a queue, not a matcher.
2. **Dispatch inputs listed in PROJECT.md** — preferred driver/vehicle,
   geofence, vehicle category, branch, depot. None are consulted; the
   reference tables they need (`Modules/Fleet`, geofencing) do not exist.
3. **Driver availability beyond "not on another live trip"** — shifts,
   rest periods, leave and qualifications are `Modules/Drivers` scope and
   are not yet modelled.
4. **Dispatch decision-time metric** — AGENTS.md's observability section
   wants it on the dashboard; nothing emits it yet.
5. **The queue does not page.** `BookingsPage` and `TripsPage` gained a
   "Load more"; the board did not. Its queue is `?dispatchable=1`, which is
   self-limiting in a way the other lists are not — a backlog past 25
   unassigned bookings is a staffing problem before it is a paging one —
   but at fifty clients it will need one, and narrowing to a client is
   currently what stands in for it.
6. **Eligibility filtering and route preview in the UI** — the design mock
   (`KangaruRide Design System/ui_kits/platform/DispatchScreen.jsx`) shows
   candidates filtered by category, geofence, depot and distance, plus a
   Mapbox route preview. `DispatchPage` offers every active vehicle and
   driver instead and lets the server decide: the reference tables and
   Mapbox integration those controls need do not exist, and a filter that
   looks real but filters nothing is worse than no filter.

## Frontend

`frontend/src/pages/DispatchPage.tsx` — the dispatch board, following the
design system's `DispatchScreen` layout: queue on the left, selected booking
and its assignment controls on the right, with a confirmation dialog.

**For Shanitah's own dispatchers the queue spans clients, so it names
them** — on each queue row, as the first fact on the assignment panel, and
inside the confirmation dialog's sentence. Three places rather than one
because the dialog is what has a dispatcher's attention at the moment a
vehicle is actually committed; naming the client only on the panel behind
it would put the safeguard where nobody is looking. Removing it from the
dialog was verified to turn `CrossClientQueue.test.tsx` red.

Whether to show any of it comes from the API's `meta.scope`, never from
inspecting the signed-in user — a page that worked that out for itself
would be another copy of ADR-0006's predicate. A client's own board is
unchanged and shows no client anywhere.

**The board also narrows to one client**, via the same `?tenant_id=` the
listings use, with `dispatchable=1` preserved alongside it — dropping that
would start offering bookings which already have a vehicle. Changing client
**clears the open assignment panel**, because a booking selected under "All
clients" is not in the narrowed queue, and a panel left open against a row
that is no longer listed is how a dispatcher commits a vehicle to something
they can no longer see. That clearing happens in the change handler rather
than an effect keyed on the client — ESLint's `set-state-in-effect` rejects
the latter, and it would also fire once on mount for no reason.

The three `409` codes are surfaced with the server's own message text rather
than a re-worded client string. The server's message names the conflicting
trip ("already assigned to trip #3"), which is the sentence a dispatcher
needs; re-wording it in the client is how the two drift apart.

After a successful assignment the board re-fetches rather than splicing the
row out of local state — another dispatcher may have taken something else in
the meantime, and a stale queue is what causes the next 409.

## Notes

**The dispatcher is Shanitah's, and the work is the client's.** Since
ADR-0006 the seeded dispatch desk belongs to no tenant, so
`BelongsToTenant::creating` has nothing to auto-fill `tenant_id` from. The
`subject-tenant` middleware binds the *booking's* tenant for the duration
of the request, so the trip, its `trip_events` and its notifications all
land in the client's records rather than in a tenant-less limbo. No code in
this module says so, which is deliberate — the rule is stated once, in
`app/Http/Middleware/BindSubjectTenant.php`, rather than in every service
that writes.

Worth knowing how it fails: remove that middleware and assignment answers
**404**, not a foreign-key error. `DispatchService`'s `lockForUpdate()`
re-read of the booking goes through `TenantScope` with nothing bound, and
the fail-closed default catches it before any write happens. That is
ADR-0001 doing its job, and it is still a broken dispatch —
`PlatformTenantBindingTest` holds the line.

`tests/Concurrency/DispatchRaceTest.php` is the AGENTS.md-mandated,
non-skippable race test. It launches **two real OS processes**, released at
the same wall-clock instant, both calling `DispatchService::assign()`, and
asserts exactly one wins and exactly one trip row exists. A single-process
test cannot express this: the loser must block on the winner's row lock,
which in one thread would simply deadlock.

It lives in its own `Concurrency` test suite rather than under `Feature`
because `RefreshDatabase` wraps each test in an uncommitted transaction that
a second connection can never see. The suite uses `DatabaseTruncation`
instead.

The test has been verified to fail when the `lockForUpdate` calls are
removed from `TripAssignmentGuard` — both dispatchers win and two trips are
written. If you change the guard, re-run that check; a race test that passes
without the lock is proving nothing.
