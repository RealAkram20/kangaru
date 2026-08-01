# Vehicles

## Purpose

Manages a tenant's fleet vehicles — the first entity `Modules/Trips` will
reference to satisfy the Bank's "vehicle registration details" acceptance
criterion (PROJECT.md).

## Responsibilities

- `Vehicle` — registration number, make/model/year, category, seating
  capacity, color, VIN, status. One record per physical vehicle.
- Demonstrates ADR-0001 like `Modules/Clients`: `Vehicle` uses
  `BelongsToTenant`, so every query is automatically scoped to the
  authenticated user's tenant. Unlike `Company`, vehicles are always
  created by an already tenant-scoped user, so the service never needs
  the `allTenants()` platform-level bypass.
- `Vehicle` also uses `App\Concerns\Auditable` — every create/update/delete
  is written to the append-only `audit_logs` table.
- Deferred to a later pass (PROJECT.md's full Fleet Management scope):
  fleet owners, branches, depots, a dedicated vehicle-categories reference
  table, maintenance records, vehicle document uploads.

## Dependencies

- `App\Concerns\BelongsToTenant`, `App\Support\Tenancy\TenantScope`,
  `App\Support\Tenancy\TenantContext` (for tenant-scoped uniqueness on
  `registration_number`).
- `App\Support\Api\ApiResponse`.

## Public APIs

Standard REST resource, all behind `auth:sanctum` + `tenant` middleware:

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/vehicles` | `viewAny` — any authenticated user (tenant scope restricts results) |
| GET | `/api/v1/vehicles/{id}` | `view` — same tenant only; another tenant's id returns 404, not 403 |
| POST | `/api/v1/vehicles` | `create` — Super Admin, Operations Manager, Fleet Owner, Branch Manager, Depot Manager |
| PATCH | `/api/v1/vehicles/{id}` | `update` — same roles as `create` |
| DELETE | `/api/v1/vehicles/{id}` | `delete` — same roles as `create` |

## Notes

`VehicleCrossTenantIsolationTest` in `tests/Feature/Vehicles/` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds for
this resource, mirroring `CompanyCrossTenantIsolationTest`.
