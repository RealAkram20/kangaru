# Fleet

## Purpose

Who a vehicle is **contracted to**, as distinct from who owns it.

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

**This module is one model.** It is not a fleet-management module yet, and
the section at the bottom is unusually long because of it.

## Responsibilities

- Record that a vehicle is allocated to a corporate account from a date,
  optionally until a date (`VehicleAllocation`).
- Answer which allocations are in force on a given day
  (`scopeInForceOn`) — written, and currently called by nothing.

Explicitly **not** this module's job:

- The vehicle itself, its documents, its status and its maintenance —
  `Modules/Vehicles`.
- Choosing a vehicle for a booking — `Modules/Dispatch`.

## Dependencies

| Depends on | For |
|---|---|
| `Modules/Vehicles` | `Vehicle`, the thing being allocated |
| `App\Models\Tenant` | the corporate account it is allocated to |
| `App\Models\User` | `created_by_user_id` — who agreed the contract |
| `App\Concerns\BelongsToTenant` | ADR-0001 tenant scoping |
| `App\Concerns\Auditable` | the append-only trail |

Nothing depends on this module. That is the problem described below, not a
design goal.

`VehicleAllocation` is `BelongsToTenant` and `Vehicle` deliberately is not.
The two sit either side of the line ADR-0005 draws — the vehicle is
Shanitah's, the allocation is the client's — and separating them is the
whole point.

## Public APIs

**There are none.** No routes, no controller, no policy, no service, no
form request. `Modules/Fleet` contains a model and seven `.gitkeep` files.

Rows are created only by `database/seeders/DemoHistorySeeder::seedAllocations()`,
which allocates the first three vehicles to Centenary Bank — one open-ended
and two with an end date, so the demo shows both shapes of contract.

The table is `vehicle_allocations`, and it is registered in the enforced
morph map as `vehicle_allocation`
(`app/Providers/AppServiceProvider.php`). **That entry is load-bearing.**
The map is enforced, so a missing alias does not fall back to the FQCN — it
throws `ClassMorphViolationException` from `getMorphClass()`, and because
the model is `Auditable` and audits on `created`, every insert into the
table threw. ADR-0005 shipped the table and nothing could write to it.
`AuditableModelsHaveMorphAliasTest` now asserts the pair for every audited
model, so the next one cannot repeat it.

## What's explicitly deferred

Named here so a half-built thing is not mistaken for a finished one. This
module is mostly deferral.

1. **Nothing consults an allocation.** This is the big one. `Modules/Dispatch`
   offers the entire platform pool for every booking regardless of contract,
   so a vehicle allocated to Centenary Bank can be dispatched on another
   client's trip and nothing objects. The table is a record, not a
   constraint.

   **The decision this was blocked on has now been taken — ADR-0009,
   3 August 2026 — and none of it is built.** An allocation *ranks* rather
   than refuses: allocated vehicles sort first for that client's bookings,
   and a dispatcher may override with a recorded reason. Hard refusal
   survives as a per-contract opt-in, `allocations.exclusive`, defaulting
   to false. The column does not exist yet either.

2. **`scopeInForceOn` is dead code.** It is correct — "started on or before,
   and either has not ended or ends on or after", so a contract's last day
   is still one of its days — and it is called by nothing. It was written
   for the dispatch check in item 1, which ADR-0009 has now specified and
   nobody has yet written.

3. **No overlap constraint.** Nothing stops the same vehicle being allocated
   to two clients over overlapping periods.

   ADR-0009 settles what the rule *is*: non-exclusive allocations may
   overlap freely, and an exclusive one may not overlap anything for that
   vehicle. It also settles that this **cannot be a schema constraint** —
   MySQL 8 has no exclusion constraint, a `UNIQUE` index cannot express a
   range predicate, and a `CHECK` cannot see other rows. It is a
   service-level check under `SELECT ... FOR UPDATE`, which makes it a
   concurrency problem with a mandatory race test, in a module that
   currently has no tests at all (item 7). Specified, not built.

4. **No API and no UI.** Allocations cannot be created, ended, listed or
   viewed by anybody. A Super Admin agreeing a new contract has no screen
   and no endpoint; the row goes in through a seeder or a database console.

   Since ADR-0009 this is the *blocker* rather than a nicety: ranking,
   exclusivity and the overlap rule are all unreachable until allocations
   can be written through something other than a seeder.

5. **Fleet ownership beyond Shanitah.** ADR-0005 notes that ownership of a
   vehicle — Shanitah's own, a fleet owner's, or a driver-partner's — is a
   Fleet concern, and that PROJECT.md's **Fleet Owner** role has had nothing
   to point at. It still has nothing to point at. There is no `fleet_owners`
   table; every vehicle is implicitly Shanitah's.

6. **Branches, depots and depot boundaries.** PROJECT.md's Fleet Management
   module names all three, and `Modules/Dispatch` lists them among the
   inputs it does not consult. None are modelled.

7. **No test of its own.** `VehicleAllocation` is covered only incidentally,
   by `AuditableModelsHaveMorphAliasTest` asserting its morph alias exists
   and by the seeder writing rows. There is no `tests/Feature/Fleet/`
   directory. Nothing asserts `scopeInForceOn`'s boundary days, which is
   the kind of off-by-one that decides whether a contract's final day is
   billable.

8. **Not opened to platform staff.** ADR-0006 gave Shanitah's own staff
   cross-tenant reads on bookings and trips. Allocations were not included,
   because with no endpoint there is nothing to open. When item 4 is built
   it needs `forActor()` like everything else, and a platform reader is
   arguably the *primary* reader here — an allocation is a contract between
   Shanitah and a client, and Shanitah is a party to it.

## Notes

The module directory has existed since the project started, holding only
`.gitkeep` files, because AGENTS.md lists `Fleet/` first in its module
layout. ADR-0005 gave it its first real occupant. It is still closer to
scaffolding than to a module, and this README exists to say so rather than
to imply otherwise.
