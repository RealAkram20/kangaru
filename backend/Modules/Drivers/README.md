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
| POST | `/api/v1/drivers/{id}/account` | `manageAccount` — `drivers.manage` **and** `staff.manage` (ADR-0016) |
| DELETE | `/api/v1/drivers/{id}/account` | `manageAccount` — same pair |
| GET | `/api/v1/me/stats` | None — the driver is the token. `403 NOT_A_DRIVER` for an account with no driver profile |

`me/stats` feeds the app's home screen and is counted on read, never stored:
trips and fares completed today, plus acceptance and completion rate over a
rolling 30 days. Rates are **null** rather than zero until there is something
to divide by — a first-shift driver shown "0%" reads it as a failing grade for
having done nothing wrong.

Two judgement calls the arithmetic makes, both fixed by tests. `superseded`
offers are excluded from acceptance: that status means dispatch pulled the
offer back, and counting it would penalise a driver for being slower than a
machine — `expired` *is* counted, because an offer that rang out is a
passenger left waiting. And `fares_today_minor` sums `fare_minor`, which only
walk-in rides carry (ADR-0026 §3); a corporate trip is invoiced to the client.
It is therefore cash taken, deliberately **not** called earnings — there is no
commission model yet, so no such figure exists.

The account sub-resource takes one of two mutually exclusive bodies:
`{email, password, role?, name?}` mints a login, `{user_id}` adopts an
existing unlinked one. `409 DRIVER_ACCOUNT_CONFLICT` if either the profile
or the account is already spoken for. `DELETE` is idempotent and revokes
every token the account holds — see ADR-0016 §5 for why that matters more
than the link itself.

### Driver applications (ADR-0027)

The queue riders put themselves in from the Driver App's sign-up form. An
application is **not** an account: until a reviewer approves it, the
applicant has no credentials on the platform at all.

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/driver-applications` | none — throttled 5/min/IP, in this module's `Routes/public.php` |
| GET | `/api/v1/driver-applications` | `viewAny` — `drivers.view`. Oldest first; `?status=` filter |
| GET | `/api/v1/driver-applications/{id}` | `view` — `drivers.view` |
| POST | `/api/v1/driver-applications/{id}/approve` | `decide` — `drivers.manage` **and** `staff.manage`, role checked against the caller's own (ADR-0004) |
| POST | `/api/v1/driver-applications/{id}/reject` | `decide` — same pair; takes a required `reason` |

The public POST deliberately answers `202` identically whether or not the
email is already known — refusing duplicates at submission would be an
oracle for "does this person drive for KangaruRide" (ADR-0027 §5). The
duplicate surfaces at approval as `409 DRIVER_ACCOUNT_CONFLICT`. Approval
creates the driver, mints the account with the password the applicant chose
at submission (hashed at the edge, cleared from the row once decided), and
links them in one transaction through `DriverAccountService`. There is no
public status checker (§6), and nobody is notified automatically — the
office phones the number the form collected. Notification hangs off SMTP,
which is ADR-0014 phase 3.

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

### Seeding a driver who can sign in

`DemoFleetSeeder` creates driver **profiles**. Since ADR-0016 a profile and
a sign-in account are two different things, so `migrate:fresh --seed` leaves
a fleet of drivers none of whom can log in — which is fine for the console
and blocks the Driver's Application entirely.

```
php artisan db:seed --class=DriverAppSeeder
```

`database/seeders/DriverAppSeeder.php` mints one account through
`DriverAccountService` (the same path the endpoint uses), assigns it an
`assigned` trip and two completed ones, and prints the credentials. It is
re-runnable, refuses to run outside `local`/`testing`/`staging`, and
restores the documented password — which matters because testing
`PATCH /auth/password` is the first thing that invalidates it, and ADR-0016
provides no self-service reset. See `mobile/README.md` for the first-test
walkthrough.

## What's explicitly deferred

- **~~`user_id` cannot be set through the API~~ — built, ADR-0016
  (7 August 2026).** Kept in place rather than deleted because it was the
  largest gap in this module and the shape of what remains is easier to
  read against it. A driver onboarded through the API could not sign in,
  and so could not capture the odometer readings two of the Bank's six
  acceptance criteria are made of.

  What shipped: `POST|DELETE /drivers/{driver}/account` as its own
  sub-resource — not a field on the driver, because creating a login is
  creating a user and folding it into `drivers.manage` would let a Depot
  Manager mint accounts from the fleet screen, defeating ADR-0004's
  escalation rule by a side door. `DriverPolicy::manageAccount` is
  therefore `drivers.manage` **and** `staff.manage`, and the *role* the
  account lands in is checked separately against the actor's own
  permissions.

  The link is exclusive on both sides, enforced by a unique index:
  `TripPolicy::transition` authorises by comparing `$trip->driver->user_id`
  to the caller, so a shared account could move two drivers' trips and
  record one driver's odometer against the other's.

  Three paths revoke, and all of them revoke *tokens* rather than only the
  link — detaching the account, suspending the driver, and deleting the
  driver (which detaches first, or the unique index would reserve the
  account against a soft-deleted row and re-hiring would fail with a
  conflict naming a driver who appears not to exist). Re-activating a
  driver deliberately does not restore the account; see ADR-0016 §5.

  Still deferred inside it: no self-service driver sign-up, no
  administrator-initiated password reset for somebody else (the same
  impersonation hazard `Modules/Administration` refuses), and no MFA for
  the driver role, which PROJECT.md confines to Super Admin and Finance.
- **~~No availability model~~ — built, ADR-0017 (7 August 2026).** A weekly
  roster (`driver_shift_windows`) and dated absences
  (`availability_blocks`) now live in `Modules/Fleet`, and
  `AvailabilityService` is the one place that combines them with status and
  live-trip conflicts. Dispatch refuses a driver on approved leave at the
  endpoint, not merely on the board.

  A driver with no roster rows is available at any hour, which is what makes
  it additive — every driver predates the table and dispatch behaves for
  them exactly as before.

  Because the Driver's Application (Phase 2) is where a driver *asks* for
  time off, a block carries a status and only `approved` withholds anybody;
  `POST /availability-blocks/{id}/answer` is where the fleet office answers.

  **Hours-of-service limits remain deferred**, and deliberately: the data is
  in `trip_events`, but how many hours in what rolling window — and what
  happens to a trip in progress when a driver hits the cap — is an
  operations decision, not an engineering one. Building it first would
  encode a guess as policy.
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
