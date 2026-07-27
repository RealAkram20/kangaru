# Clients

## Purpose

Manages corporate clients (tenants) and their business profile — the
first real tenant-scoped module and the reference pattern every later
module (Fleet, Bookings, Trips, ...) copies.

## Responsibilities

- `Company` — the business profile of a tenant (legal name, billing
  contact, credit limit, status). One Company per Tenant in Phase 1.
- Demonstrates ADR-0001 in practice: `Company` uses `BelongsToTenant`, so
  every query is automatically scoped to the authenticated user's tenant.
- Future: departments, employees, branches, cost centers (PROJECT.md
  Company Management module).

## Dependencies

- `App\Models\Tenant` — the identity anchor `Company.tenant_id` foreign-keys
  to (`app/`, cross-cutting platform infrastructure — see ADR-0001).
- `App\Concerns\BelongsToTenant`, `App\Support\Tenancy\TenantScope`.
- `App\Support\Api\ApiResponse`.

## Public APIs

Standard REST resource, all behind `auth:sanctum` + `tenant` middleware:

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/companies` | `viewAny` — any authenticated user (tenant scope restricts results) |
| GET | `/api/v1/companies/{id}` | `view` — same tenant only; another tenant's id returns 404, not 403 |
| POST | `/api/v1/companies` | `create` — Super Admin only (platform-level, bypasses tenant scope) |
| PATCH | `/api/v1/companies/{id}` | `update` — Super Admin or Corporate Admin |
| DELETE | `/api/v1/companies/{id}` | `delete` — Super Admin only |

## Notes

This pass manages an *existing* tenant's own Company profile. Full
self-service tenant *onboarding* (provisioning a brand-new tenant through
the API) is out of scope — Super Admin creates the `Tenant` and `Company`
rows directly for now (see `database/seeders/DatabaseSeeder.php`).

The `CompanyCrossTenantIsolationTest` in `tests/Feature/Clients/` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds for
this resource — every new tenant-scoped resource should get an equivalent
test.
