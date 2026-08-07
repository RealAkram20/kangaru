# ADR-0017: Driver and vehicle availability

**Status:** Accepted (7 August 2026)

## Context

Three parts of the platform had an opinion about whether a driver or a
vehicle could take work, and they were three different opinions:

- `VehicleCandidates` meant `status = 'active'`.
- `TripAssignmentGuard` meant "not already on a live trip".
- Nothing at all meant "not on leave", "not in the workshop", "not off
  shift" — because none of those were recorded anywhere.

`Modules/Drivers/README.md` and `Modules/Vehicles/README.md` both named the
gap in the same words: *"No availability model… no way to ask who is free at
a given time"*. `Modules/Dispatch/README.md` listed it as the buildable half
of automatic dispatch — the half that does **not** wait on ADR-0003's live
positions.

The practical consequence was that a dispatcher could be shown a van the
workshop had, choose it, and be told nothing. There was no fact in the
system to refuse them with.

## Decision

### 1. One service answers "is this free?", and everything asks it

`Modules\Fleet\Services\AvailabilityService` combines all four signals —
status, live trip, calendar block, roster — and returns an `Availability`
value object carrying a stable code and a sentence.

Both the candidate listing and the assignment endpoint call it. That is the
same discipline `AllocationLookup` already holds for contracts, for the same
reason: two implementations of one refusal drift silently, and the drift
appears as a list that says free beside an endpoint that says no.

A value object rather than a bool because every caller needs the reason —
the board greys a row and explains it, the endpoint puts it in a 409, and a
future automatic dispatcher will log why it chose what it chose.

### 2. One table for both resources

`availability_blocks` is discriminated by `resource_type` (`driver` /
`vehicle`) rather than split in two, because the question is identical and
the overlap predicate is the entire correctness of the feature. Two tables
would be two copies of it.

The discriminator is a closed enum, not Laravel's `morphTo`. The set is two,
the values are the words an operator uses, and a fully-qualified class name
in a data column is one refactor away from orphaning every historical row.

Overlap is **half-open**, `[starts_at, ends_at)`. A block ending at 14:00 and
a trip starting at 14:00 do not clash: a van out of the workshop at two is
available at two. Closed intervals would refuse every back-to-back booking
in the fleet, which is how an availability feature gets switched off a week
after launch. `ends_at IS NULL` is open-ended — the honest record when a
vehicle fails an inspection and nobody yet knows what the part costs.

Not tenant-scoped, like the fleet itself (ADR-0005). Scoping a service
booking to a client would make the same van look free to every other client.

### 3. Rosters are separate from absences, and both are needed

`driver_shift_windows` holds a weekly roster: weekday, start time, end time.
A block says "not this Tuesday"; a window says "Tuesdays, 06:00–18:00, every
week". Expressing a roster as fifty-two weeks of blocks is not a roster.

**A driver with no windows is available at any hour.** That is what makes
this additive: every driver predates the table, and dispatch behaves for
them exactly as it did before it existed. Rostering is adopted one depot at
a time rather than in a cutover.

Times are local wall-clock in the platform timezone, stored as `TIME`. A
shift is "six in the morning" to the person driving it and stays six in the
morning across a DST change; storing an instant would move it silently.
`ends_at < starts_at` means the shift wraps past midnight — a night shift is
normal in this business, and forbidding the wrap would force operators to
split each one into two rows that no longer read as one shift.

Both ends of a job must fall inside a window. Checking only the start would
roster a driver onto a job beginning ten minutes before they clock off.

### 4. The assumed trip duration is configuration

A trip's real duration is unknowable in advance, so availability is judged
over `[scheduled_for, scheduled_for + dispatch.assumed_trip_minutes)`,
default 120. A literal buried in a service would be the hardcoded rate
AGENTS.md forbids. Too short and a driver is offered overlapping jobs; too
long and the fleet looks busier than it is, and dispatchers start ignoring
the flag — which is worse than not having one.

### 5. The permission follows the resource

No `availability.manage`. Recording that a van is in the workshop is the same
authority as editing that van, so it is `vehicles.manage`; a driver's leave
is `drivers.manage`. Inventing a permission would mean a new grant seeded
onto exactly the roles that already hold those two — a second name for an
existing thing, and one more row to get wrong.

It also preserves a real distinction for free: a depot manager who may book a
van in for a service but may not sign a driver off sick.

Reading is deliberately wider (`*.view`, held by every system role) because a
dispatcher who cannot see that a vehicle is blocked will keep trying to
dispatch it.

### 6. A block has a status, because the Driver's Application is coming

PROJECT.md Phase 2 is the Driver's Application, and it is where a driver asks
for time off and where the fleet office answers. That makes the same row two
different things depending on who wrote it: the office recording a workshop
booking is stating a fact; a driver asking for Friday is making a request.

Modelling only the first and adding a `leave_requests` table later would give
the platform two tables that both mean "not available", consulted by one
dispatcher — and the day they disagree, somebody is dispatched onto a shift
they were told they had off.

So: one table, three statuses, and **only `approved` withholds anything from
dispatch**. A request nobody has answered is not yet time off; treating it as
one would let anyone leave the roster by asking.
`POST /availability-blocks/{id}/answer` is where the office answers.
Answering twice is `409 AVAILABILITY_ALREADY_ANSWERED` — silently
re-deciding leave is how a driver and a depot end up holding two different
answers. Answering your own request is `403`, the same reasoning that stops
an account changing its own role. Declined rows are kept, not deleted: "I
asked and was refused" is exactly the fact people later disagree about.

**The asking half shipped on 7 August 2026**, when the Driver's Application
hit its absence. `POST /availability-blocks` requires `drivers.manage` — a
permission that also lets you edit anybody's profile, and one the driver
role must not hold — so a driver had no way to ask at all.

It is a separate route, `POST /me/availability-requests`, rather than a
relaxed policy on the shared one. That endpoint would then have had to
accept `resource_id` and `status` from a caller who must control neither,
guarded by validation; one forgotten check and a driver books leave for a
colleague or grants themselves the `approved` status that withholds them
from dispatch. **The driver route takes neither field at all** — the block
is pinned to the caller's own profile, in the `requested` state, by the
controller. A driver cannot ask on somebody else's behalf because there is
nowhere to say whose. Both pins are mutation-tested.

`/me/` rather than `/drivers/{id}/` for the same reason: an id in the path
is a thing to tamper with. `GET` lists the caller's own requests and their
answers; `DELETE` withdraws one **only while unanswered**, because deleting
an approval would put a driver back on the roster with nobody knowing the
decision had been undone. Another driver's request answers 404, not 403 —
403 would confirm the row exists.

An account with no driver profile behind it gets `403 NOT_A_DRIVER`: an
operations manager opening the driver app is a support question, not a
missing endpoint.

### 7. Trip clashes stay with the guard

`AvailabilityService` reports `ON_TRIP`, and `DispatchService` deliberately
ignores that one verdict, leaving it to `TripAssignmentGuard` — the only
thing holding the pessimistic locks that make that answer race-proof. Two
checks of the same fact, one unlocked, is how a guarantee is quietly
downgraded to a probability. The existing dispatch race tests still pass
unchanged, which is the assertion that this held.

## Consequences

Dispatch now refuses a driver on approved leave and a vehicle in the
workshop, at the endpoint and not merely on the board — a dispatcher may post
any pair of ids, and a constraint that exists only in a list somebody was
shown is not a constraint.

The candidate list marks blocked vehicles `dispatchable: false` with a
deliberately vague note ("Not available for this time"). A board shared
across a depot should not announce that a named driver is off sick, and for a
vehicle the operational fact is the whole of what a dispatcher acts on. The
specific kind stays queryable by the people who are supposed to see it, and
exists precisely so `Modules/Reports` can one day split utilisation by cause
— a fleet losing days to maintenance has a different problem from one losing
them to leave.

Automatic dispatch (item 4 of the Phase 1 completion program) now has its
availability input. Distance still waits on ADR-0003.

Deferred, and named rather than implied: **hours-of-service limits**. The
data is there — `trip_events` timestamps every transition — but the *rule* is
an operations decision (how many hours in what rolling window, whose
responsibility to enforce it, what happens to a trip in progress when a
driver hits the cap) and not an engineering one. Building a cap before that
decision exists would encode a guess as policy. Also deferred: per-driver
timezones, holiday calendars, and rosters that vary week to week — all three
are real, none is Phase 1, and all three sit on top of this schema rather
than replacing it.

## Alternatives considered

**Computing availability from trips alone.** What the platform did. It cannot
express leave, maintenance or a roster, which is the whole gap.

**A boolean `is_available` on driver and vehicle.** Cheap and wrong: it has no
time dimension, so it cannot answer "is this free next Tuesday", and somebody
has to remember to flip it back.

**Separate `driver_availability` and `vehicle_availability` tables.** Rejected
in §2 — two copies of the overlap predicate.

**A separate leave-request table for the Driver's Application.** Rejected in
§6 — two tables meaning "not available", one dispatcher reading them.

**Blocking on ADR-0003 so availability could include distance.** Distance is a
ranking input for automatic dispatch, not part of whether a resource is free.
Coupling them would have left leave and maintenance unrecorded until the
Redis work landed.
