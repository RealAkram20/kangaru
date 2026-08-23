# Vehicles

## Purpose

The vehicle register. Supplies "vehicle registration details", one of the
six data points Centenary Bank's letter requires on every trip
(PROJECT.md).

**The fleet belongs to the platform (ADR-0005).** Shanitah owns and
operates every vehicle; a corporate account is a client and owns none. A
vehicle may be *allocated* to a client for a period — what the Bank's
letter means by "vehicles supplied to the Bank" — and that is a contract,
recorded on `vehicle_allocations` in `Modules/Fleet`, not ownership here.

## Responsibilities

- `Vehicle` — registration number, make/model/year, category, seating
  capacity, colour, VIN, status. One record per physical vehicle.
- `VehicleCategory` — the fleet's category vocabulary, **a table since
  ADR-0050**. `key` (immutable, and what every vehicle, rate card rate and
  invoice line stores), `name` (editable, and what every screen renders),
  `description`, `active`, `position`.
- `Modules\Vehicles\Rules\ActiveVehicleCategory` — the one definition of
  "a category the fleet currently offers", used by all four call sites that
  validate one. Four hand-mirrored lists drifting apart is the failure
  ADR-0050 exists to end, and it had already happened twice.
- `Vehicle::CATEGORIES` survives as the **seed list only**: the migration
  reads it, and `RideVehicleClass`'s class-to-category mapping names its
  members. It is no longer the validation source.
- `Auditable` — every create/update/delete is written to the append-only
  `audit_logs` table.
- `allocations()` — the periods this vehicle is contracted to a corporate
  account.

## Dependencies

- `App\Enums\Permission` — authorization is permission-based (ADR-0004).
- `App\Concerns\Auditable` — the audit trail.
- `Modules\Fleet\Models\VehicleAllocation` — the allocation records.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode` — response envelope.

**Not** `BelongsToTenant`, deliberately. That is the ADR-0005 change: a
global tenant scope here would hide the shared pool from every dispatcher.

## Public APIs

Standard REST resource, all behind `auth:sanctum` + `tenant` middleware:

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/vehicles` | `viewAny` — `vehicles.view`, seeded on every system role |
| GET | `/api/v1/vehicles/{id}` | `view` — same permission |
| POST | `/api/v1/vehicles` | `create` — `vehicles.manage` |
| PATCH | `/api/v1/vehicles/{id}` | `update` — `vehicles.manage` |
| DELETE | `/api/v1/vehicles/{id}` | `delete` — `vehicles.manage` |
| GET | `/api/v1/vehicle-categories` | `viewAny` — `vehicles.view` **or** `bookings.create` |
| POST | `/api/v1/vehicle-categories` | `create` — `vehicles.manage` |
| PATCH | `/api/v1/vehicle-categories/{id}` | `update` — `vehicles.manage` |
| DELETE | `/api/v1/vehicle-categories/{id}` | `delete` — `vehicles.manage` |

The category read is deliberately wider than the fleet read (ADR-0051 §3):
a corporate client picks the kind of vehicle they want on the booking form,
and the two corporate roles hold none of the fleet permissions. It exposes
**names, not the roster** — `vehicles_count` is omitted for any actor
without `vehicles.view`, because how many vans the platform owns is the
fleet register in aggregate and `docs/security-gate.md` F2 withholds it.

`DELETE` on a category answers **409 `VEHICLE_CATEGORY_IN_USE`** when a
vehicle, a rate card price or an invoice line names the key. No foreign key
enforces that — those columns are plain strings on purpose, so an issued
invoice reproduces without joining a table somebody can rename — so the
controller's refusal is the only thing standing between a delete and an
immutable rate card rate naming nothing.

There is no tenant filtering on these results, and that is the point: one
pool, every dispatcher sees all of it.

## Notes

`registration_number` is **globally unique**. It was
`unique(['tenant_id', 'registration_number'])`, which let two tenants
register the same number plate; a plate is unique in Uganda under any
reading, and that constraint was wrong independently of ADR-0005.

`tests/Feature/Vehicles/VehicleCrossTenantIsolationTest.php` was
**repointed, not removed**, when the fleet moved. "Another tenant's
vehicle" no longer names anything, so it now asserts that the pool is
deliberately shared — a stray `BelongsToTenant` creeping back fails loudly
instead of quietly halving what dispatch can reach. AGENTS.md calls the
isolation suite non-skippable; this records why one member changed meaning.

## What's explicitly deferred

- **Allocation is not enforced.** `vehicle_allocations` exists and records
  which vehicles are contracted to which client, but **nothing consults
  it** — dispatch offers the whole pool regardless of contract. The table
  is currently a record, not a constraint.
- ~~**Vehicle categories are validated strings, not a reference table.**
  Adding a category means editing `Vehicle::CATEGORIES` and shipping.~~
  **Closed by ADR-0050 (21 August 2026).** `vehicle_categories` is a table
  the office edits from the Vehicles screen; the key is immutable because
  issued invoice lines store it, and "delete" becomes "retire" the moment
  anything uses it. **The console had also never been able to create a
  vehicle** — `store`, `update` and `destroy` existed since Phase 1 with no
  screen calling them — and that is closed in the same change.
- **No maintenance records.** PROJECT.md's Fleet Management scope lists
  maintenance and "Vehicle Maintenance Due" is a named notification type;
  neither exists.
- **No vehicle documents** — no insurance, inspection or logbook uploads,
  and so no expiry tracking, despite "Document Expiring" being a named
  notification.
- **No fleet owners, branches or depots.** PROJECT.md has a Fleet Owner
  role and branch/depot dispatch inputs; there is nothing for them to
  point at. Ownership by a fleet owner or driver-partner is a `Modules/Fleet`
  concern and is unbuilt.
- **~~No availability model~~ — built, ADR-0017 (7 August 2026).**
  `availability_blocks` records maintenance, inspection and repair periods
  against a vehicle, and `Modules\Fleet\Services\AvailabilityService`
  answers "is this vehicle free at 14:00 on Thursday". Dispatch refuses a
  vehicle in the workshop and the candidate list marks it undispatchable.

  Overlap is half-open, so a vehicle out of the workshop at 14:00 is
  available at 14:00; `ends_at` null is open-ended, for the honest record
  when a vehicle fails an inspection and nobody yet knows what the part
  costs. Recording one needs `vehicles.manage` — the permission follows the
  resource rather than being one of its own.
- **No telematics.** Odometer readings come from the driver at trip start
  and end (`Modules/Trips`), not from the vehicle.
