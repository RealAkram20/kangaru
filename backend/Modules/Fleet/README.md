# Fleet

## Purpose

Who a vehicle is **contracted to**, as distinct from who owns it — and what
that contract constrains.

ADR-0005 established that the fleet belongs to the platform: Shanitah owns
and operates every vehicle and driver, and a corporate client owns none of
either. But Centenary Bank's letter (CRDB/CS/F/26, 22 July 2026) asks about
"all vehicles **supplied to** the Bank", and that phrase is not ownership —
it is a contract for a period. This module is where that contract lives.

The distinction is the module's entire reason to exist. The old schema said
"supplied to" with `vehicles.tenant_id`, which made the arrangement
permanent, exclusive and indistinguishable from ownership: a vehicle on
hire to the Bank this quarter and doing hailing work the next could not be
expressed at all.

ADR-0009 (3 August 2026) then answered what an allocation *does*. Until it
landed, this module was a record nothing consulted. It now constrains
dispatch.

## The register of fleet companies (K2, ADR-0055 / ADR-0059)

Added 22 August 2026, and it removes a rail that was up on purpose.

`Operator` carried a docblock saying *"There is deliberately no way to create
a second one"* — no endpoint, no policy, no factory, no seeder — because
between `F0` and `F2` the operational tables carried `operator_id` and nothing
filtered on it, so a second fleet's dispatcher would have read Shanitah's
trips. `F2` closed that gap and `K0` proved the schema on MySQL 8.4, so
creation is offered here. This was blocker number one in
`docs/fleet-model-plan.md` §4b.

**Four things a reader should not have to rediscover:**

1. **The level is the control, not the permission.** Every Super Admin holds
   `fleets.manage`, a fleet's own included — `StoreRoleRequest` refuses to let
   anybody grant a permission they do not hold, so withholding it would make
   it ungrantable rather than strict. `OperatorPolicy` requires
   `access_level = kangaru` on every method. Same shape as `support.act-as`.
2. **A fleet and its first account are created together or not at all.**
   ADR-0056 acts as a *person*, not an organisation, so a fleet with no
   account is permanently unreachable to support — and it fails when "the last
   administrator left" and "we need support" coincide. `owner_name` and
   `owner_email` are required for that reason.
3. **Counts, never operational data.** `OperatorResource` carries four counts
   and no trips, drivers by name, clients by name or revenue. ADR-0055 §2 is
   easiest to breach by adding one more useful field, so
   `OperatorRegisterTest` pins the key list rather than trusting review.
4. **There is no delete.** Six operational tables carry `operator_id` and
   `operator_client` restricts on delete; a removal would either fail against
   its own history or orphan it. A fleet that leaves is suspended.

**Still true, and carried here so it is not discovered:** `trip_events`,
`trip_locations` and `trip_stops` are not independently fleet-scoped. They are
reached through a trip and the trip is the gate. Sound today because no route
reaches them without resolving a trip first; it stops being sound the moment
somebody adds one.

**Plans.** `K2` created the `plans` table and `operators.plan_id` to hold one
invariant — ADR-0058 §1, no fleet exists without a plan, and creation *fails*
rather than defaulting when nothing is flagged default. Everything that makes
a plan commercial (price, period, limits, Kangaru's invoice to a fleet) is
`K7`'s, and nothing here presumes its shape. A plan move goes through
`PUT /operators/{operator}/plan` **alone** — `PATCH /operators/{operator}`
accepted `plan_id` once, and the bare `update()` behind it skipped
`PlanAllowance`'s downgrade refusal (ADR-0058 §4), so the field was removed
rather than guarded twice. The plan may also be chosen at onboarding
(`POST /operators` takes an optional `plan_id`), with no allowance check — a
fleet being born has nothing to exceed a limit with.

**Ownership transfer** (owner's decision, 24 August: *"changing the email is
changing the ownership"*). `PUT /operators/{operator}/owner` proposes a new
owner by name and email; the address — which must belong to **no** existing
account — gets a mail-only invitation to choose a password, and until they do
nothing changes: no account exists, the sitting owner keeps every access, and
`DELETE .../owner` withdraws the proposal without a trace. Acceptance
(`POST /owner-transfers/{token}/accept`, public like the invitation and for
its reason) creates the new `FLEET_OWNER` and suspends the previous one in a
single transaction — create first, then suspend, so the account count never
passes through zero (ADR-0059 §5). It is deliberately **not**
`UserAdminService::update()` writing `email`: renaming an account in place
would re-attribute the old owner's audit rows, dispatches and invoices to the
new person's name, and the history must keep saying who acted.
`OwnershipTransfer` is the pending row; `OwnershipTransferService` is the
only thing that ever holds the plaintext token.

### A new permission does nothing until `RoleSeeder` runs — and re-running it has a side effect

Found the hard way while verifying `K3` in a browser. `fleets.view` and
`fleets.manage` were added to `App\Enums\Permission` and `RoleSeeder` grants
Super Admin `P::cases()`, so both looked granted. They were not: **role rows
hold a snapshot of the permission list**, and the seeded row still carried the
39 permissions that existed when it was written, against 42 in the enum. Every
`/operators` request answered 403 to a Kangaru Super Admin, and nothing in the
code said why.

`php artisan db:seed --class=RoleSeeder --force` fixes it, and it is a
**deployment step for this change**, not a local convenience.

**The side effect, which cost more than the bug.** `RoleSeeder` also sets
`roles.requires_mfa`, so re-running it switched MFA back **on** for Super Admin
and Finance — an environment where it had been deliberately turned off. Three
console accounts went to "must enrol" at the next sign-in with no warning. If
you re-seed roles on an environment where MFA has been relaxed, check
`roles.requires_mfa` on `super_admin` and `finance` afterwards and put it back.

## Responsibilities

- Record that a vehicle is allocated to a corporate account from a date,
  optionally until a date (`VehicleAllocation`).
- Answer which allocations are in force on a given day (`scopeInForceOn`)
  and which periods collide (`scopeOverlapping`).
- Enforce the one rule that decides whether an allocation may exist:
  **an exclusive allocation may not overlap any other allocation for that
  vehicle; non-exclusive ones may overlap freely** (`AllocationService`).
- Answer dispatch's two questions about a day: what is contracted to this
  client, and is this vehicle exclusively somebody else's
  (`AllocationLookup`).
- Serve the allocation API — agree, end, list, show.

Explicitly **not** this module's job:

- The vehicle itself, its documents, its status and its maintenance —
  `Modules/Vehicles`.
- Choosing a vehicle for a booking — `Modules/Dispatch`. The ranking rule
  and the override live there; only the lookup lives here.

## Dependencies

| Depends on | For |
|---|---|
| `Modules/Vehicles` | `Vehicle`, the thing being allocated |
| `App\Models\Tenant` | the corporate account it is allocated to |
| `App\Models\User` | `created_by_user_id` — who agreed the contract |
| `App\Concerns\BelongsToTenant` | ADR-0001 tenant scoping, and `forActor()` |
| `App\Concerns\Auditable` | the append-only trail |
| `App\Support\Tenancy\ClientOptions` | the shared client picker payload |

`Modules/Dispatch` depends on this module (`AllocationLookup`); this module
depends on nothing of Dispatch's, which is the direction that keeps the
boundary above honest.

`VehicleAllocation` is `BelongsToTenant` and `Vehicle` deliberately is not.
The two sit either side of the line ADR-0005 draws — the vehicle is
Shanitah's, the allocation is the client's — and separating them is the
whole point.

## Public APIs

All under `/api/v1`, behind `auth:sanctum` + `tenant` + `subject-tenant`.

| Route | Ability | Notes |
|---|---|---|
| `GET /allocations` | `allocations.view` | `forActor()` — platform staff see every client, named. Carries `meta.filters.clients`. |
| `GET /allocations/{allocation}` | `allocations.view` | Another client's 404s, never 403s. |
| `POST /allocations` | `allocations.manage` | 409 `ALLOCATION_CONFLICT` when the overlap rule refuses. |
| `PATCH /allocations/{allocation}` | `allocations.manage` | Ends the contract on a given day. The only mutation. |
| `GET /driver-presence` | `drivers.view` | Who is on duty and where — the live map's pool (ADR-0024 §2, the office's read). See below. |
| `GET /public/nearby-vehicles` | public, throttled 30/min | Anonymized available vehicles near a point — positions and silhouettes only. See below. |

Ending is a PATCH rather than a DELETE, and it is the only change offered.
Moving a contract's *start* after the fact would rewrite which days a client
was owed a vehicle, and the trips dispatched under it would stop being
explicable. Corrections mean ending one contract and agreeing another, which
leaves both visible to the audit log.

`allocations.view` is seeded with dispatch (a dispatcher who cannot see the
contract cannot tell a considered ranking from an arbitrary one) and to
Corporate Admin as a party to their own. `allocations.manage` is the Super
Admin's alone.

### What an allocation constrains (ADR-0009)

- **`exclusive = false`** (the default, and the Bank's case): the vehicle
  ranks first for that client's work and remains available to everyone
  else's. A dispatcher may pass over it, but must give a reason, which is
  stored on `trips.allocation_override_reason` and logged as
  `vehicle.dispatched_off_allocation`.
- **`exclusive = true`**: the vehicle may be dispatched only on that
  tenant's trips for the period. Anything else is refused with
  `409 VEHICLE_EXCLUSIVELY_ALLOCATED`, and no reason buys a way past it.

Both are visible before the act, not only on being stopped by it:
`GET /bookings/{booking}/candidate-vehicles` (`Modules/Dispatch`) returns
the pool ranked with contracted vehicles first, each marked `allocated`,
`dispatchable` and `requires_override_reason`. A vehicle contracted
exclusively elsewhere is listed and flagged rather than dropped, because
ADR-0009 asks for a clear error rather than an empty list — and no note
anywhere names the other client.

### The overlap rule is code, not schema

MySQL 8 cannot express "no two rows for this vehicle with overlapping date
ranges": there is no exclusion constraint (that is PostgreSQL's `EXCLUDE
USING gist`), a `UNIQUE` index cannot describe a range predicate, and a
`CHECK` cannot see other rows. The rule therefore lives in
`AllocationService`, under `SELECT ... FOR UPDATE` on the vehicle row —
the same treatment AGENTS.md mandates for dispatch assignment.

**Because the guarantee is application code rather than schema, the race
test is the constraint.** `tests/Concurrency/AllocationRaceTest.php` is the
only thing holding it. It was proved by removing the lock and watching both
exclusive contracts win, and it includes a control that races two
*non*-exclusive contracts and requires both to survive, so a lock that
simply serialised everything cannot pass it.

The conflict query runs `allTenants()` deliberately: the question is whether
*somebody else's* contract is in the way, and TenantScope would hide exactly
those rows, leaving a check that passes because it cannot see what it is
looking for.

## Demo data

`DemoHistorySeeder::seedAllocations()` writes **four** rows for Centenary
Bank: three non-exclusive (one open-ended, two with an end date) and one
exclusive, so a demo shows both branches — a preferred vehicle that can be
overridden with a reason, and a dedicated one that dispatch simply refuses
for anybody else.

The table is `vehicle_allocations`, registered in the enforced morph map as
`vehicle_allocation` (`app/Providers/AppServiceProvider.php`). **That entry
is load-bearing.** The map is enforced, so a missing alias does not fall back
to the FQCN — it throws `ClassMorphViolationException` from
`getMorphClass()`, and because the model is `Auditable` and audits on
`created`, every insert into the table threw. ADR-0005 shipped the table and
nothing could write to it. `AuditableModelsHaveMorphAliasTest` now asserts
the pair for every audited model.

## Availability (ADR-0017)

The second thing this module owns: **when** a driver or vehicle can work, as
distinct from **who** a vehicle is contracted to.

- `AvailabilityBlock` — a dated period a driver or vehicle is unavailable.
  One table for both, discriminated by a closed `resource_type` enum.
  Half-open overlap `[starts_at, ends_at)`, so a van out of the workshop at
  14:00 is available at 14:00; `ends_at` null is open-ended.
- `DriverShiftWindow` — a weekly roster. **No rows means available at any
  hour**, which is what keeps the feature additive for the drivers who
  predate it.
- `AvailabilityService` — the one place status, live trips, blocks and
  rosters are combined. `Modules/Dispatch` calls it from both the candidate
  listing and the assignment path, so the two cannot drift.

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/availability-blocks` | `viewAny` — `drivers.view` or `vehicles.view` |
| POST | `/api/v1/availability-blocks` | `createFor` — `drivers.manage` or `vehicles.manage`, following the resource |
| POST | `/api/v1/availability-blocks/{id}/answer` | `respond` — same, and never your own request |
| DELETE | `/api/v1/availability-blocks/{id}` | `delete` — same |

A block carries a status because the Driver's Application is where a driver
*asks* for time off and this is where the office answers. Only `approved`
withholds anything from dispatch — a request nobody has answered is not yet
time off. Answering twice is `409 AVAILABILITY_ALREADY_ANSWERED`.

**The driver's own half** (ADR-0017 §6, shipped 7 August 2026):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me/availability-requests` | the caller's own requests and their answers |
| POST | `/api/v1/me/availability-requests` | asks; throttled 10/min |
| DELETE | `/api/v1/me/availability-requests/{id}` | withdraws, only while unanswered |

These take **no `resource_id` and no `status`** — both are set by the
controller, so a driver cannot ask on somebody else's behalf or grant
themselves leave. That is structural, not validated, and both pins are
mutation-tested. An account with no driver profile gets `403 NOT_A_DRIVER`.

`AvailabilityService` reports `ON_TRIP` but `DispatchService` ignores that
one verdict, leaving trip clashes to `TripAssignmentGuard` — the only thing
holding the locks that make that answer race-proof.

## Geofencing (ADR-0021)

The third thing this module owns: **where** things are, as distinct from
when (availability) and whose (allocations).

- `Zone` — a named ring with a kind (`service_area`, `pricing`, `client`,
  `branch`, `depot`), a priority and an optional tenant. Boundaries are JSON
  arrays of `{lat, lng}` objects, never GeoJSON's positional `[lng, lat]` —
  that ordering is the bug ADR-0020 records this codebase actually hitting.
- `BoundaryRing` — the geometry, tested on its own in
  `tests/Unit/BoundaryRingTest.php`. A point on the boundary counts as
  inside, with a ~1 m tolerance, because a hairline edge behaves randomly.
- `ZoneResolver` — the one place a point becomes a set of zones. Returns
  them narrowest-first, so no caller needs to know the priority numbers.

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/zones` | `viewAny` — `zones.view`, on every system role |
| GET | `/api/v1/zones/resolve` | `viewAny` — which zones contain a point |
| POST | `/api/v1/zones` | `create` — `zones.manage` (Ops Manager, Super Admin) |
| PATCH | `/api/v1/zones/{id}` | `update` — same |
| DELETE | `/api/v1/zones/{id}` | `delete` — soft, so priced invoices keep their reference |

**Coverage is opt-in.** `withinServiceArea()` is true when no service area
has been drawn — an operator mid-mapping must not have every order refused.
Once one exists, `POST /public/order-requests` refuses a pickup outside it,
which is what finally catches a swapped lat/lng.

**Zone pricing is built, in `Modules/Billing`** (ADR-0021 §7–§11).
`ZoneResolver::pricingZoneAt()` is its only entry point here;
`Billing\Pricing\TripZoneResolver` owns the separate question of *which
point* prices a trip, and `RateCardZoneRate` holds what that zone charges.
Billing depends on Fleet; Fleet does not depend on Billing.

Two consequences land on this module:

- **A zone rate can hold a `zone_id` open.** `rate_card_zone_rates.zone_id`
  and `invoice_lines.zone_id` are both `restrictOnDelete`. Retiring a zone
  soft-deletes it, so that is not a wall an operator can hit — but a hard
  delete of a zone that priced an invoice is now refused by the database,
  which is the intent.
- **Deactivating a zone is a pricing act.** A switched-off zone stops being
  resolved, so any rate card rate attached to it quietly stops applying and
  the vehicle category's default rate takes over. That is deliberate: an
  immutable rate card version must not be invalidated by a map edit. It is
  also why `zones.manage` sits with Operations Manager and Super Admin only.

Zone-based dispatch eligibility is still not built; the resolver is the
input it will use.

## The office's read of presence — `GET /driver-presence` (20 August 2026)

`driver_presence` was written for the matcher and, until the live map was
made real, only the matcher read it. `GET /driver-presence` lists every
driver currently on duty — by name and plate, with their last reported
position, `age_seconds`, `stale`, and the occupying trip that has them if
one does — so a dispatcher can look at the map and count who is waiting
for work.

Two things it does on purpose:

- **`DriverPresenceStore::onDuty()`, not `dispatchable()`.** The matcher hides
  a driver whose position has gone stale, because it must not rank them
  from a place they have left. The map shows that driver greyed and marked
  `stale`, because the map's job is to get them phoned. A driver who has
  never reported (location refused on the handset) is listed with null
  coordinates — the page says "no position", it does not invent one.
- **Allow-listed fields.** Driver id and name; vehicle id, plate, make,
  model. No phone, no licence number, no VIN — the fleet register serves
  those behind its own policy. Gated by `DriverPolicy::viewAny`
  (`drivers.view`): the roles that operate the fleet, and not a client's
  people (docs/security-gate.md F2) — the riders are Shanitah's.

`/live-positions` (Trips) is the other half of the same map: the vehicles
on a trip, named the same way. The two responses share `age_seconds` and
`stale` so a page can merge them and sort by who needs attention.

### The public read — `GET /public/nearby-vehicles` (20 August 2026)

The same pool, for surfaces that may not know who is in it: the order
page's ambient fleet (which used to be six sprites at hardcoded offsets)
and a corporate client's live map (which `/driver-presence` refuses).
Dispatchable drivers with a usable position, **minus anyone on an
occupying trip**, nearest the given point first, within 15km, capped at
twelve.

Anonymized by construction: each entry is `key` (an hourly-rotating hash —
markers glide within the hour, a day of polling follows nobody),
`category`, a sprite `kind`, coordinates and `age_seconds`. No driver id,
name, plate or phone, ever — the register stays behind `drivers.view`
(docs/security-gate.md F2). Radius and cap mean one call can never dump
the fleet. This is ADR-0005's deferred "nearby-driver search", buildable
once ADR-0024 §2 built presence.

## Duty sessions (ADR-0038)

`driver_duty_sessions` records one row per shift — on duty at `started_at`,
off duty at `ended_at` — so the driver app's Performance screen can say how
long somebody was online. Before this, it could not: `driver_presence` is one
row per driver, overwritten in place, and holds no history at all.

**This is not the presence history ADR-0024 §2 refused.** That objection is
about *telemetry* — a row per heartbeat, carrying coordinates, answering
"where was this driver at 11:04", and the source of its 500M-row estimate.
This table takes two rows per driver per day and has nowhere to put a
position. `driver_presence` keeps its job unchanged.

### The three ways a shift ends

| Ending | Written by | `ended_reason` |
|---|---|---|
| The driver signs off | `PUT /me/duty` with `on_duty: false` | `driver` |
| The platform stops hearing from them | `duty:close-stale`, **at the last heartbeat** | `stale` |
| They sign on again without signing off | `open()` reuses the running shift | — (none opened) |

The staleness rule is what makes the figure honest rather than flattering. A
shift that only ever ended when somebody remembered to end it would report a
phone left in a drawer over a weekend as a fifty-hour week.

It reuses `dispatch.presence_ttl_seconds` rather than taking a setting of its
own **on purpose**: that is already the line at which dispatch stops offering
this driver work, and a driver the platform will not send a job to was not
online. Two settings would eventually disagree, and the disagreement would
surface as somebody being credited hours in which nobody could reach them.

### The exception the rule needs

**A driver on a live trip is never swept, and the sweep refreshes their
session instead.** The app's heartbeat is a JavaScript `setInterval` and stops
when the handset backgrounds the app — exactly what happens when a phone goes
into a cradle and the driver drives. Without this a two-hour journey would
report as three minutes online, and the sweep would sign the driver off with a
passenger aboard.

Refreshing rather than merely skipping matters: when the trip ends the shift
must be closable from a *recent* mark, or the whole journey is discarded by
the next sweep.

### Running it

```
php artisan duty:close-stale          # scheduled every minute
php artisan duty:close-stale --ttl=60 # a tighter window, for testing
```

A missed run degrades the figure rather than breaking it — an unclosed session
is simply still open, and the next run closes it at the same last heartbeat it
would have used an hour earlier.

`RosterService` answers the other half: how many hours a driver was
**rostered** for over a span, from `driver_shift_windows`. It returns **null**,
never zero, for a driver with no windows — ADR-0017 §3 makes that mean
"available at any hour", which is not a number, and the screen draws no arc
against it.

## What's explicitly deferred

Named here so a half-built thing is not mistaken for a finished one.

1. **No UI.** ADR-0009 puts this out of scope explicitly — the API first,
   the screen after, as ADR-0006 did with the dispatch queue. A Super Admin
   agreeing a contract has an endpoint and still no screen, and the override
   reason has no field to be typed into.

2. **`AllocationService::end()` takes no lock, on purpose.** Ending only
   shrinks a period, and a shorter period cannot overlap anything the longer
   one did not. If a future change lets a contract be *extended*, that
   reasoning stops holding and the lock becomes necessary.

3. **The "must run inside a transaction" tripwire is untested.**
   `RefreshDatabase` wraps every test in a transaction, so
   `DB::transactionLevel()` is never 0 in the suite and the guard cannot be
   provoked. It is a developer-facing assertion, recorded as untested rather
   than left looking covered.

4. **Allocation of drivers.** Only vehicles are allocable. Whether a client
   can contract a named driver is a real question — the Bank may well ask —
   and ADR-0009 puts it out of scope with employment implications it has no
   view on.

5. **Rate implications of an allocation.** Whether a contracted vehicle
   prices differently belongs to `Modules/Billing` and the rate card.
   Nothing in ADR-0009 touches money, and nothing here does either.

6. **Fleet ownership beyond Shanitah.** There is no `fleet_owners` table;
   every vehicle is implicitly Shanitah's, and PROJECT.md's **Fleet Owner**
   role still has nothing to point at.

7. **Branches, depots and depot boundaries.** PROJECT.md's Fleet Management
   module names all three and `Modules/Dispatch` lists them among the inputs
   it does not consult. None are modelled.

8. **No office view of who is on duty, or for how long.** ADR-0038 gives that
   feature its table and its arithmetic — `DutySessionService::secondsIn()`
   answers it for any driver over any window — but the only surface reading it
   is the driver's own Performance screen. A fleet office asking a driver to
   work more hours should be quoting a figure rather than an impression, and
   right now they cannot see one.

8. **Automatic dispatch is not this.** ADR-0009 supplies a ranking *input*;
   it is not the matcher. Distance still blocks that, and distance needs
   ADR-0003's live positions, which are unbuilt.

9. **An exclusive allocation can strand a booking.** A client whose only
    exclusive vehicle is in maintenance has no fallback dispatch will accept.
    That is correct — it is what exclusivity was bought — and the 409
    explains it, but nothing routes around it or warns anyone in advance.
