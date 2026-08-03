# ADR-0009: What a Vehicle Allocation Constrains

**Status:** Accepted (3 August 2026)

**Depends on:** ADR-0005 (Accepted). The fleet belongs to the platform; a
vehicle may be *allocated* to a corporate account for a period.

**Resolves:** the two items `Modules/Fleet/README.md` names as blocked on a
product decision — "Nothing consults an allocation" and "No overlap
constraint" — which it correctly refused to settle by reading PROJECT.md.

## Context

ADR-0005 created `vehicle_allocations` to express Centenary Bank's
"vehicles **supplied to** the Bank" as a contract rather than as ownership.
It shipped the table and stopped there, deliberately.

What exists today, verified 3 August 2026:

- `VehicleAllocation` — the model, `BelongsToTenant`, `Auditable`, with a
  `scopeInForceOn` whose boundary logic is correct.
- The table, with indexes on `(tenant_id, starts_on, ends_on)` and
  `(vehicle_id, starts_on)`. **No uniqueness and no overlap constraint.**
- Rows, written by `DemoHistorySeeder::seedAllocations()` alone.
- **No callers.** `scopeInForceOn` is referenced by nothing outside its own
  definition and the README that documents it as dead code. No route, no
  controller, no policy, no service, no request.

So `Modules/Dispatch` offers the entire platform pool for every booking
regardless of contract. A vehicle allocated to Centenary Bank can be
dispatched on another client's trip and nothing objects. The table is a
record, not a constraint.

### Why the README could not settle it

Its framing is right: hard refusal matches a bank that has paid for
dedicated vehicles, soft ranking matches a hailing operator with one pool,
and PROJECT.md describes both businesses. Reading PROJECT.md harder does
not break the tie.

But the Bank's letter can be read, and it resolves less than has been
assumed. `CRDB/CS/F/26` requires that all vehicles supplied *operate an
automated system capturing and reporting* six data points per trip. That is
a **telematics obligation on the vehicles used for the Bank's work**. It is
not an exclusivity clause. Nothing in the anchor contract says a vehicle
allocated to the Bank may not carry anybody else on a Tuesday afternoon.

That matters, because the argument for hard refusal rested on the contract
demanding it, and the contract does not.

### What hard refusal would cost

A global hard refusal makes an allocation an exclusivity grant by
definition. A vehicle allocated to the Bank could then never take a walk-in
fare — and walk-ins are not a hypothetical, they are PROJECT.md's Phase 3
and half of what ADR-0005 says the business is. The platform would have
adopted, as a permanent invariant, a rule that only one of its two customer
types can live with, in order to satisfy a clause its anchor client did not
write.

## Decision

**An allocation ranks; it does not refuse. Exclusivity is a property of the
individual contract, not of the mechanism.**

### 1. Dispatch prefers allocated vehicles, and may be overridden

For a booking belonging to tenant T, vehicles with an allocation to T in
force on the trip date rank above vehicles without one. A dispatcher may
still choose an unranked vehicle; doing so **requires a reason**, which is
recorded on the trip and audited.

The reason is the part that makes this more than a sort order. "Allocated
vehicles first" with a silent override is a suggestion nobody can audit
afterwards; with a recorded reason, "why was the Bank's contracted vehicle
not used on the 14th" is a question the platform can answer. That is the
same instinct that produced the audit log, applied to a dispatch choice.

### 2. `allocations.exclusive` — hard refusal, per contract

The allocation row gains a boolean, defaulting to **false**.

- **`exclusive = false`** (the default, and the Bank's case): the vehicle
  is contracted to that client and ranks first for their work, and remains
  available to everyone else's.
- **`exclusive = true`**: the vehicle may be dispatched **only** on that
  tenant's trips for the period. An attempt to dispatch it elsewhere is
  refused — `409`, per AGENTS.md's use of 409 for "vehicle already
  assigned"-shaped conflicts — and no override exists.

This is the substance of the decision, not a hedge between the two options.
Hard refusal is a real thing some clients will pay for; it is simply not a
property of *allocation*, it is a property of *a particular deal*. Modelling
it globally forces every client into whichever answer the last argument
produced. Modelling it per row lets the sales conversation decide, which is
where it belongs, and it means neither business is designed out.

### 3. The overlap rule follows from `exclusive`, and only now can be written

`Modules/Fleet/README.md` was right that the constraint could not be
written before this decision. With it:

- Non-exclusive allocations for one vehicle **may overlap freely.** A
  vehicle contracted to two clients who each get priority over strangers is
  a coherent arrangement and a likely one.
- An exclusive allocation **may not overlap any other allocation** for the
  same vehicle, exclusive or not. Exclusivity that coexists with another
  contract is not exclusivity.

### 4. The overlap check is a concurrency problem, not a schema one

This is the part that must not be mistaken for an index.

MySQL 8 cannot express "no two rows for this vehicle with overlapping date
ranges" declaratively. There is no exclusion constraint — that is
PostgreSQL's `EXCLUDE USING gist` — and a `UNIQUE` index cannot describe a
range predicate. A `CHECK` cannot see other rows. The constraint is
therefore a **service-level check**, and a service-level check on a
uniqueness invariant is a race unless it is locked.

It gets the same treatment AGENTS.md already mandates for dispatch
assignment: the overlapping-allocation read is a `SELECT ... FOR UPDATE` on
the vehicle row inside the transaction that writes the allocation, so two
concurrent exclusive allocations for one vehicle cannot both pass their
check. **A race test is mandatory** — two simultaneous exclusive
allocations over overlapping periods, exactly one of which may win.

Two reasons this is stated so heavily. This project has already shipped a
race test that passed vacuously, and has hit two InnoDB deadlocks in
`Modules/Dispatch`, so the lock ordering here is not theoretical. And
because the guarantee lives in application code rather than in the schema,
the test *is* the constraint — there is nothing else holding it.

Per AGENTS.md, the race test must be proved: written, the `FOR UPDATE`
removed, the test observed going red, and the lock restored.

## Consequences

**`scopeInForceOn` stops being dead code**, and its boundary days become
load-bearing. The README already flags that nothing asserts them and that a
contract's final day being billable or not is decided there. That test is
part of this work.

**`Modules/Fleet` gets its first API.** Allocations must be creatable,
endable and listable before any of this is reachable — README item 4. A
Super Admin agreeing a contract currently has no screen and no endpoint,
and this decision makes that gap the blocker rather than a nicety.

**A platform reader is the primary reader.** Per README item 8, an
allocation is a contract between Shanitah and a client and Shanitah is a
party to it, so the listing needs `forActor()` from the first commit rather
than as a later retrofit. Writes bind the subject's tenant per ADR-0006 —
and note the shape here is ADR-0007's, not ADR-0006's: creating an
allocation names a tenant in the request body rather than acting on an
existing tenant-owned record, so `BindSubjectTenant` has nothing to read
and the tenant must come from the validated payload with an explicit
authorization check.

**Dispatch gains a reason field and an audit event.** Overriding a
preference is a business event in the sense AGENTS.md's Observability
section means; `vehicle.dispatched_off_allocation` is the stable name.

**Exclusive allocations can strand a booking.** A client whose only
exclusive vehicle is in maintenance has no fallback that dispatch will
accept. That is the correct behaviour — it is what exclusivity was bought —
but it needs a clear error rather than an empty vehicle list, per AGENTS.md
on error messages explaining what to do next.

**The demo seed changes shape.** `seedAllocations()` currently writes three
non-exclusive-by-implication rows. They become explicitly non-exclusive,
and the demo is worth extending with one exclusive allocation so both
branches are visible.

## Scope

**In:** the `exclusive` column, the allocation CRUD API and policy, the
dispatch ranking, the override reason and its audit event, the overlap
check with its lock and race test, `scopeInForceOn` boundary tests, and the
Fleet README rewrite that follows from all of it.

**Out, deliberately:**

- **Automatic dispatch.** This gives a ranking input; it is not the
  matcher. Distance still blocks that, per ADR-0005 and PROJECT.md.
- **Allocation of drivers.** Only vehicles are allocable. Whether a client
  can contract a named driver is a real question — the Bank may well ask —
  and it is a different one, with employment implications this ADR has no
  view on.
- **Rate implications of an allocation.** Whether a contracted vehicle
  prices differently belongs to `Modules/Billing` and the rate card, not
  here. Nothing in this ADR touches money.
- **Fleet ownership beyond Shanitah**, branches and depots — README items 5
  and 6. Untouched.
- **A UI.** The API first; the screen follows, as ADR-0006 did with the
  dispatch queue.

## Alternatives considered

**Global hard refusal.** Matches a dedicated-fleet business and makes the
overlap constraint trivially "never overlap". Rejected: the anchor contract
does not require it, and it would permanently prevent an allocated vehicle
taking hailing work, designing out half the business ADR-0005 describes.

**Global soft ranking with no exclusivity.** Simplest, and was the shape
first considered. Rejected because it leaves the README's overlap question
open exactly as it is today — with no notion of exclusivity there is no
rule that says any two allocations conflict, so the constraint stays
unwritable and the item stays blocked. It answers the dispatch question by
declining the other one.

**An exclusivity flag on the *vehicle* rather than the allocation.**
Fewer moving parts. Rejected: it says "this vehicle is always dedicated",
which is a property of the vehicle's whole life rather than of a contract
that runs from a date to a date. The same vehicle dedicated to the Bank
this quarter and pooled the next is precisely the case ADR-0005 created
this table to express.

**Enforcing overlap with a generated column and a unique index.** Some
range problems can be forced into a unique index by discretising the range
— a row per month, say. Rejected: it changes what an allocation *is* to
suit MySQL's constraint vocabulary, multiplies rows, and still cannot
express a half-open contract with a null `ends_on`, which is the common
case.
