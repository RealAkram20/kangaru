# Clients

## Purpose

Corporate clients and their business profile — the first real
tenant-scoped module and the reference pattern the genuinely tenant-owned
modules (Bookings, Trips, Billing, Reports, Notifications) copy.

**A tenant is a corporate account, not an operator (ADR-0005).** It has
users, roles, bookings, trips and invoices; it owns no vehicle and no
driver. What is genuinely the client's stays tenant-scoped, and this
module is where that boundary is drawn.

## Responsibilities

- `Company` — the business profile of a tenant: legal and trading name,
  registration number, industry, billing contact, address, credit limit,
  status. One Company per Tenant in Phase 1.
- The reference implementation of ADR-0001: `Company` uses
  `BelongsToTenant`, so every query is automatically scoped to the
  authenticated user's tenant.
- `Auditable` — every create/update/delete, `credit_limit_minor` changes
  included, is written to the append-only `audit_logs` table and is
  queryable through `Modules/Administration`'s `/audit-logs` endpoint.
  AGENTS.md names credit limits explicitly as an audited mutation.
- `credit_limit_minor` is an **integer in minor units** (whole UGX), per
  AGENTS.md's money rules. Never a float.

## Dependencies

- `App\Models\Tenant` — the identity anchor `Company.tenant_id` foreign-keys
  to. Lives in `app/` as cross-cutting platform infrastructure (ADR-0001).
- `App\Concerns\BelongsToTenant`, `App\Support\Tenancy\TenantScope`,
  `App\Support\Tenancy\TenantContext`.
- `App\Enums\Permission` — authorization is permission-based (ADR-0004).
- `App\Concerns\Auditable` — the audit trail.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode` — response envelope.

## Public APIs

Standard REST resource, all behind `auth:sanctum` + `tenant` middleware:

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/companies` | `viewAny` — `companies.view`; tenant scope restricts results |
| GET | `/api/v1/companies/{id}` | `view` — same permission. Another tenant's id returns **404, never 403** |
| POST | `/api/v1/companies` | `create` — `companies.create`, seeded on Super Admin alone |
| PATCH | `/api/v1/companies/{id}` | `update` — `companies.update` |
| DELETE | `/api/v1/companies/{id}` | `delete` — `companies.delete` |

Creating a company is deliberately platform-level: a Super Admin has no
tenant context for the scope to auto-fill `tenant_id` from. Since ADR-0006
the service binds the *requested* tenant for the duration of the write —
`TenantContext::for($attributes['tenant_id'], ...)` — rather than mass
assigning past the scope with `allTenants()`. Same row, but it states which
client the write is for instead of stating that scoping does not apply.

The listing is `Company::forActor($user)`: one client's profile for a
client's user, every client's for platform staff. That was the first of the
five hand-rolled bypasses ADR-0006 collapsed into one name.

## Notes

`tests/Feature/Clients/CompanyCrossTenantIsolationTest.php` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds here.
Since ADR-0005 moved the fleet to the platform, this module — together
with Bookings, Trips and Billing — is where the isolation surface that
actually matters now lives: a client's movements and money, not their
vehicles.

## What's explicitly deferred

- **No self-service tenant onboarding.** This module manages an *existing*
  tenant's profile. Provisioning a brand-new tenant is not exposed through
  the API at all — a Super Admin creates the `Tenant` row directly, in
  practice via `database/seeders/DatabaseSeeder.php`. `POST /companies`
  attaches a profile to a tenant that must already exist.
- **The credit limit is recorded but never enforced.** `credit_limit_minor`
  is stored and audited; nothing checks a booking, a trip or an invoice
  against it. No balance is tracked, nothing blocks, nothing warns.
  PROJECT.md lists credit limits under Finance — that half is unbuilt.
- **One Company per Tenant, assumed but not constrained.** The schema
  permits more than one and nothing enforces the assumption.
- **No departments, employees, branches or cost centres.** PROJECT.md's
  Company Management module names all four. Users belong to a tenant flat,
  with no structure beneath it, so a bank cannot yet split spend by branch
  or cost centre — which is the shape a bank will eventually want its
  invoice in.
- **No per-client contract terms.** Pricing lives in `Modules/Billing`'s
  rate cards; commercial terms (notice periods, SLAs, the allocation
  contract behind "vehicles supplied to the Bank") are not modelled here.
  Vehicle allocation is recorded in `Modules/Fleet` and, as that module's
  notes record, is not yet enforced anywhere.
- **Individual riders are not clients.** A booking currently requires both
  a `tenant_id` and a `requested_by_user_id`, so a walk-in fits nowhere in
  this module. ADR-0005 names it as its own decision; PROJECT.md puts
  individual customers at Phase 3.

---

## Places and routes (ADR-0045)

A corporate client servicing an ATM estate does not book a journey to a
destination — they send a team round a circuit. `client_places` is the
register of pinned locations that circuit is built from; `client_routes`
plus `client_route_stops` is the circuit; `client_route_members` is the team
who ride it.

**These four tables are the *plan*, and nothing downstream reads them.** A
trip raised from a route copies its stops onto `trip_stops` (a later pass),
and from that moment the two have nothing to do with each other. Editing the
Monday ATM run in October must not change what September's invoice was for
— the same reasoning `RateCardVersion` applies to money, applied to
geography.

Three consequences worth knowing before touching this code:

1. **Stops are rewritten wholesale, never shuffled.**
   `client_route_stops` has a unique key on `(client_route_id, sequence)`,
   so `ClientRouteService::replaceStops()` deletes and re-inserts inside a
   transaction. Sequence comes from the array's position, so a `sequence`
   sent by a caller is ignored. A proved mutation: sorting the incoming
   array turns the officer's drag order into id order and
   `ClientRouteTest` catches it.
2. **Omitting `stops` is not the same as sending `[]`.** The service reads
   both with `array_key_exists`, so a PATCH that only renames a route keeps
   its stops. Replacing that with an unconditional call makes a rename a
   delete — also proved by mutation.
3. **`exists:client_places,id` is not the isolation check.** It says the row
   is real, not that it is yours. Ownership is decided under the tenant
   scope in the service and **refused by name**, never filtered out — a save
   that silently dropped one ATM would hand back a shorter circuit with a
   success message on it.

4. **The roster is set from the staff screen, not the route builder.**
   `client_route_members` shipped with the routes and went unused, because
   putting a new starter on four circuits meant opening four routes. It is
   now `route_ids[]` on `POST`/`PATCH /users` — saved whole like
   `capabilities`, so taking somebody off the Monday run is expressible —
   and `UserAdminService::replaceRoutes()` carries its isolation guard.
   `exists:client_routes,id` is not that guard, for the reason (3) gives:
   the route must belong to the same tenant as the person, and a route that
   does not is **refused by name**, never filtered away.

   It stays a roster and not a permission. Nothing authorises off it —
   `ClientRoutePolicy` gates on `routes.view` / `routes.manage` and
   `ClientCapability::MANAGES_ROUTES` exactly as it would if the table did
   not exist.

Shanitah's staff read routes and never write them (`ClientRoutePolicy`):
partly because ADR-0045 §9 says a bank's cash circuit is the bank's
decision, and partly because platform staff have no tenant for
`BelongsToTenant` to fill, so the write would be a 500 rather than a
feature. Removing the tenancy half of that check produces exactly that 500,
which is how it was verified.

### Deferred here, deliberately

- **`trip_stops` and the copy-on-booking path** — ADR-0045 §1, the evidence
  half. Until it lands, a route is something a client can build and look at,
  and no journey carries stops.
- **The driver's arrive / continue / skip actions** — ADR-0045 §2. The
  lifecycle needs no new status for them; they hang off the existing
  `waiting ⇄ trip_resumed` cycle.
- **Waypoint routing** — ADR-0045 §7. `RouteProvider` still takes two
  points, so nothing yet draws a circuit's line or states its distance.
  This is why `ClientRouteResource` carries no distance and no duration.
- **Schedules** — ADR-0045 §8. A route is a template; recurring generation
  stays as B3 in `docs/corporate-client-panel-plan.md`.
- **Stop-order optimisation** — offered by both routing providers and
  refused: a cash run's sequence is a security decision, not a
  travelling-salesman problem.
