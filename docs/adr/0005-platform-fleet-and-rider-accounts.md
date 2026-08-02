# ADR-0005: The Fleet Belongs to the Platform

**Status:** Accepted

**Amends:** ADR-0001 (Multi-Tenancy Model). Tenant scoping stands; what is
*inside* a tenant changes.

## Context

Shanitah General Enterprises operates the fleet and the platform. The
business is a ride-hailing and vehicle-hire operator — Faras, Uber, Bolt,
SafeBoda — not a product sold to fleet operators to run themselves.

Its customers are of two kinds:

- **Corporate accounts.** Centenary Bank's letter (CRDB/CS/F/26, 22 July
  2026) asks that "all vehicles supplied to the Bank operate an automated
  system" reporting six data points per trip. The Bank's staff ride; the
  Bank is invoiced monthly; the Bank's administrators manage their own users
  and access. This is the "Uber for Business" shape.
- **Individual riders.** Walk-ins who order a ride, a vehicle or a delivery
  with no company behind them.

The implementation resolved an ambiguity in PROJECT.md the wrong way. It
reads "multi-tenant" as *each tenant runs its own transport operation*, so
`vehicles.tenant_id` and `drivers.tenant_id` give every client a private
fleet. The seed makes it plain: Centenary Bank has three vehicles and three
drivers, Acme NGO has a different three and three. There is no Shanitah
fleet anywhere in the schema.

Two further symptoms of the same mistake:

- Dispatchers and Finance officers are seeded *inside* client tenants, as
  though the Bank employed them. They are Shanitah staff.
- `unique(['tenant_id', 'registration_number'])` permits two tenants to
  register the same number plate. A plate is unique in Uganda under any
  reading; the constraint is wrong independently of this ADR.

The letter's phrase is the tell. A vehicle is **supplied to** the Bank. That
is an allocation under contract, and the schema models it as ownership.

## Decision

**Vehicles and drivers belong to the platform, not to a tenant.**

The owner's words, which are the clearest statement of it: *"vehicles and
drivers are worked and managed by Shanitah (KangaruRide); a tenant remains
a corporate account; corporate clients are simply clients — they own no
vehicle and no driver."*

- `vehicles` and `drivers` lose `tenant_id`. `registration_number` and
  `license_number` become globally unique, which is what they are.
- A vehicle may be **allocated** to a corporate account for a period — the
  Bank's "supplied to" — as its own record, not as ownership. Allocation
  constrains dispatch when present and is absent for hailing work.
- **A tenant is a corporate account**, not an operator. It keeps its users,
  its roles (ADR-0004), its bookings, its trips and its invoices. Everything
  that is genuinely the client's stays tenant-scoped.
- **Shanitah's own staff are platform-level** — no `tenant_id`, as Super
  Admin already is. Dispatchers, Finance, HR and Operations serve every
  client.
- **Individual riders belong to no tenant.** Making that expressible is
  named here but deliberately not solved by this ADR (see Scope below).

## Consequences

**Two mandatory isolation tests change meaning.**
`DriverCrossTenantIsolationTest` and the vehicle equivalent prove that one
tenant cannot see another's fleet. That ceases to be true by design: every
dispatcher works one pool. They are **rewritten, not removed** — to assert
that a client sees only their own *trips, bookings and invoices*, which is
where the confidential data actually lives. AGENTS.md calls the isolation
suite non-skippable; this records why one of its members is being
repointed rather than quietly edited.

**The remaining isolation surface is what matters more, not less.** A
shared fleet means a leak can no longer be caught by "did a vehicle from
another tenant appear". It has to be caught on trips, bookings, invoices
and staff — the rows that carry a client's movements and money.

**Migration is additive first**, per the zero-downtime rule: add the
allocation table and drop `tenant_id` from the fleet in a later step, never
a rename in one. Existing rows collapse from two private fleets to one
pool, and the demo seed changes shape.

**28 test files** build fixtures with `forTenant()` on vehicles and
drivers. They stop needing it, which is the smaller half of the work; the
larger half is that dispatch, trips, billing and reports all assume the
vehicle they touch is same-tenant.

**`Modules/Fleet` stops being empty scaffolding.** Ownership of a vehicle —
Shanitah's own, a fleet owner's, or a driver-partner's — is a Fleet
concern, and PROJECT.md's Fleet Owner role has had nothing to point at.

## Scope

**In:** moving vehicles and drivers to the platform, allocation records,
repointing the two isolation tests, and the seed.

**Moved out mid-pass — relocating Shanitah's staff.** The decision stands
(dispatchers, Finance, HR and Operations are Shanitah's, not the Bank's),
but doing it needs something this ADR did not account for: a user with no
`tenant_id` gets `TenantScope`'s fail-closed default, so a platform
dispatcher would see **no bookings and no trips at all**. Making them work
means giving platform staff cross-tenant reads on the operational tables —
a change to how ADR-0001's scope is applied, which deserves its own
decision rather than arriving as a side effect of a seeder edit.

Until then staff stay tenant-scoped. The fleet move does not depend on it:
a dispatcher sitting inside Centenary Bank's tenant now dispatches the
platform's whole pool, which is the behaviour that was actually wrong.

**Explicitly out, and each its own decision:**

- **Individual riders.** A booking currently requires both a `tenant_id`
  and a `requested_by_user_id`; a walk-in has neither. PROJECT.md puts
  individual customers at Phase 3.
- **Automatic dispatch.** Now confirmed as part of the target model —
  the platform runs *both* automatic and manual dispatch — and moved from
  PROJECT.md's out-of-scope list by owner approval, as PROJECT.md's own
  rule requires. It is out of *this* pass, not out of the plan.

  Worth separating, because the two halves have different blockers.
  Matching on availability, vehicle category and passenger count is
  buildable the moment a shared pool exists, which is what this ADR
  delivers. Matching on **distance** is not: it needs live driver
  positions, and ADR-0003's Redis half — the live-position reads — is
  deliberately unbuilt. An automatic dispatcher that cannot tell which
  driver is nearest is a queue, not a matcher.

- **Hailing.** Fare estimates, nearby-driver search and real-time
  accept/decline. Same blocker as distance-based matching, plus payment.
- **Payments.** Nothing records money coming in. A corporate account on
  monthly invoicing survives that; for a walk-in, taking the payment *is*
  the transaction. Mobile money is not integrated.
- **Delivery.** Goods, consignee, proof of delivery. Absent from PROJECT.md
  entirely — new scope, not a deferred item.

Doing the fleet correction alone is deliberate. It is the thing that is
actively wrong, it is what the Bank's contract is judged on, and a shared
pool is a prerequisite for hailing anyway — automatic matching has nothing
to match against while every client owns a private fleet.

## Alternatives considered

**A "Shanitah" tenant that owns the fleet, with cross-tenant dispatch.**
Keeps `tenant_id` everywhere and needs no migration of the column.
Rejected: it makes `TenantScope` mean two different things depending on the
table, and every fleet query becomes an explicit opt-out of the very scope
ADR-0001 made mandatory. The exception would be load-bearing and permanent.

**Keep per-tenant fleets and add a shared pool alongside.** Rejected: two
sources of truth for what a vehicle is, and dispatch would have to merge
them under a lock. The per-tenant fleet is not a feature anyone asked for;
it is a misreading being preserved.
