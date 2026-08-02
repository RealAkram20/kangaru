# Drivers

## Purpose

The driver register — who may be assigned to a trip, and who signs in to
walk one through its lifecycle.

**Drivers belong to the platform (ADR-0005).** Shanitah employs and
manages every driver; a corporate account is a client and employs none.
Unlike vehicles, a driver is never "allocated" to a client — there is no
driver equivalent of `vehicle_allocations`.

## Responsibilities

- `Driver` — name, phone, email, licence number, licence expiry, status.
  One record per driver.
- `Driver.user_id` (nullable FK to `users`) links a driver profile to the
  account that signs in as them. `Modules/Trips` needs it so a driver can
  trigger their own transitions — the `trips.transition.own` permission is
  ownership expressed as a permission pair (ADR-0004).
- `Auditable` — every create/update/delete is written to the append-only
  `audit_logs` table.

## Dependencies

- `App\Models\User` — the account a driver signs in as.
- `App\Enums\Permission` — authorization is permission-based (ADR-0004).
- `App\Concerns\Auditable` — the audit trail.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode` — response envelope.

**Not** `BelongsToTenant`, deliberately, for the same reason as
`Modules/Vehicles`: one pool, visible to every dispatcher.

## Public APIs

Standard REST resource, all behind `auth:sanctum` + `tenant` middleware:

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/drivers` | `viewAny` — `drivers.view`, seeded on every system role |
| GET | `/api/v1/drivers/{id}` | `view` — same permission |
| POST | `/api/v1/drivers` | `create` — `drivers.manage` |
| PATCH | `/api/v1/drivers/{id}` | `update` — `drivers.manage` |
| DELETE | `/api/v1/drivers/{id}` | `delete` — `drivers.manage` |

## Notes

`license_number` is **globally unique**, having been unique per tenant —
the same correction as the vehicle plate, and wrong independently of
ADR-0005.

`tests/Feature/Drivers/DriverCrossTenantIsolationTest.php` was
**repointed, not removed** when the fleet moved; see the equivalent note
in `Modules/Vehicles/README.md`.

There is deliberately no `tenant()` relation on `Driver`. ADR-0005 dropped
`drivers.tenant_id`, but the relation outlived the column, so
`$driver->tenant` was a query against a column that no longer exists.
Nothing called it, so nothing ever failed — it has been removed rather
than left as a trap for whoever called it first.

## What's explicitly deferred

- **`user_id` cannot be set through the API.** Neither `StoreDriverRequest`
  nor `UpdateDriverRequest` accepts it, so the link between a driver
  profile and the account that signs in as them is populated only by
  seeders, tests or direct Eloquent. In practice a driver onboarded
  through the API today **cannot sign in to run their own trips**. This is
  the largest gap in this module.
- **No availability model.** A driver has a `status` string. There is no
  shift calendar, no leave, no hours-of-service limit, and no way to ask
  who is free at a given time — which is also what
  ADR-0005 names as the buildable half of automatic dispatch.
- **Licence expiry is stored but not acted on.** `license_expiry` is a
  column; nothing warns, nothing blocks assignment of a driver whose
  licence has lapsed, and "Document Expiring" is a named notification type
  that is not wired to it.
- **No documents.** No licence photo, no ID, no upload of any kind — and
  AGENTS.md requires driver documents be app-level encrypted at rest when
  they arrive.
- **No qualifications or vehicle-category eligibility.** Any driver may be
  assigned to any vehicle; nothing records who may drive a bus.
- **No performance tracking.** Rejections are recorded against a driver in
  `trip_events` (`Modules/Trips`), but nothing aggregates them into a
  rating, an acceptance rate, or anything a dispatcher can sort by.
- **No driver-facing flow lives here.** PROJECT.md puts drivers on a
  mobile-responsive web flow in Phase 1 and a native app in Phase 2;
  neither is in this module.
