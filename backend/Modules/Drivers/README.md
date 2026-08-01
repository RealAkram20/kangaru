# Drivers

## Purpose

Manages a tenant's driver profiles — the second entity `Modules/Trips`
will reference alongside `Modules/Vehicles` to build the trip lifecycle.

## Responsibilities

- `Driver` — name, phone, email, license number, license expiry, status.
  One record per driver.
- `Driver.user_id` (nullable FK to `users`) links a driver profile to the
  authenticated account that logs in as them — `Modules/Trips` needs this
  so a driver can trigger their own trip transitions. **Known gap**: there
  is no request-layer or UI support for setting `user_id` through the API
  yet (`StoreDriverRequest`/`UpdateDriverRequest` don't accept it) — it's
  populated only via direct Eloquent, seeders, or tests for now. Wiring
  this into the create/update flow is a follow-up Drivers-module pass.
- Demonstrates ADR-0001 like `Modules/Clients` and `Modules/Vehicles`:
  `Driver` uses `BelongsToTenant`, so every query is automatically scoped
  to the authenticated user's tenant.
- `Driver` also uses `App\Concerns\Auditable` — every create/update/delete
  is written to the append-only `audit_logs` table.
- Deferred to a later pass (PROJECT.md's full Driver Management scope):
  qualifications, availability, performance tracking, document uploads
  (license photo, ID).

## Dependencies

- `App\Concerns\BelongsToTenant`, `App\Support\Tenancy\TenantScope`,
  `App\Support\Tenancy\TenantContext` (for tenant-scoped uniqueness on
  `license_number`).
- `App\Support\Api\ApiResponse`.

## Public APIs

Standard REST resource, all behind `auth:sanctum` + `tenant` middleware:

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/drivers` | `viewAny` — any authenticated user (tenant scope restricts results) |
| GET | `/api/v1/drivers/{id}` | `view` — same tenant only; another tenant's id returns 404, not 403 |
| POST | `/api/v1/drivers` | `create` — Super Admin, Operations Manager, Fleet Owner, Branch Manager, Depot Manager |
| PATCH | `/api/v1/drivers/{id}` | `update` — same roles as `create` |
| DELETE | `/api/v1/drivers/{id}` | `delete` — same roles as `create` |

## Notes

`DriverCrossTenantIsolationTest` in `tests/Feature/Drivers/` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds for
this resource, mirroring `CompanyCrossTenantIsolationTest`.
