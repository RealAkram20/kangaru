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

8. **Automatic dispatch is not this.** ADR-0009 supplies a ranking *input*;
   it is not the matcher. Distance still blocks that, and distance needs
   ADR-0003's live positions, which are unbuilt.

9. **An exclusive allocation can strand a booking.** A client whose only
    exclusive vehicle is in maintenance has no fallback dispatch will accept.
    That is correct — it is what exclusivity was bought — and the 409
    explains it, but nothing routes around it or warns anyone in advance.
