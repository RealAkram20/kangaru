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
| GET | `/api/v1/me/earnings?period=day\|week\|month` | Same — the driver is the token |
| GET | `/api/v1/me/ledger-entries?cursor=&from=&to=` | Same — the driver is the token |
| GET | `/api/v1/me/trips?cursor=&service_type=` | Same — the driver is the token |
| GET/POST | `/api/v1/me/settlement-requests` | Same — the driver is the token. `tip` also 404s on a trip that is not theirs |
| GET | `/api/v1/settlement-requests` | `viewAny` — `drivers.manage` |
| POST | `/api/v1/settlement-requests/{id}/confirm` | `answer` — `drivers.manage` |
| POST | `/api/v1/settlement-requests/{id}/decline` | `answer` — `drivers.manage` |
| GET | `/api/v1/me/profile` | None — the driver is the token |
| GET/POST | `/api/v1/me/documents` | Same — the driver is the token |
| GET | `/api/v1/me/documents/{id}/file` | `view` — the owner, or `drivers.manage` |
| GET | `/api/v1/drivers/{id}/documents` | `viewAny` — `drivers.manage` |
| GET | `/api/v1/drivers/{id}/documents/{doc}/file` | `view` — `drivers.manage` |
| POST | `/api/v1/drivers/{id}/documents/{doc}/verify` | `review` — `drivers.manage` |
| POST | `/api/v1/drivers/{id}/documents/{doc}/reject` | `review` — `drivers.manage` |

`me/stats` feeds the app's home screen and is counted on read, never stored:
trips and fares completed today, plus acceptance and completion rate over a
rolling 30 days. Rates are **null** rather than zero until there is something
to divide by — a first-shift driver shown "0%" reads it as a failing grade for
having done nothing wrong.

### `me/profile` — the profile screen

Who the driver is on the platform: name, phone, their own vehicle, when they
joined, how many trips they have finished, and a one-line documents summary.

**Separate from `me/stats` on purpose.** Stats is polled by the home screen
every sixty seconds; this is opened deliberately and carries a lifetime
`COUNT`, a vehicle join and a documents summary that no poll should pay for.
The same argument that kept `me/earnings` off `me/stats`.

**The rating is deliberately not in this payload**, even though the screen
shows one. `me/stats` already produces it under ADR-0030's withholding rule,
and a second reading of a figure suppressed below five ratings is a second
chance to publish it by mistake. The app reads both endpoints and puts them
side by side.

`vehicle` is null for a driver who has none, which is not an edge case — a
corporate driver takes whatever the depot hands them, and
`driver_presence.vehicle_id` is the per-shift answer.

### Driver documents (ADR-0033)

The feature behind the profile screen's **Documents** row. That row is why it
exists: printing "Verified" against a compliance fact the platform did not hold
would be relied on by a driver at a checkpoint and by an operator answering a
regulator.

**Four types, none named for one country** — `driving_licence`,
`identity_document`, `vehicle_insurance`, `vehicle_registration`. The obvious
East African list (*PSV badge*, *logbook*) was deliberately not used: a type
enum lands in a column, an OpenAPI enum and every shipped handset, and is then
untouchable.

**One row per driver per type.** Re-uploading replaces the file and resets the
status to `pending`, clearing the review — a document the office verified is
not evidence for a different file that arrived afterwards. The new file is
written *before* the row is repointed and the old one deleted *after*, so a
failure anywhere leaves a row pointing at a file that exists.

**`expired` is derived, never stored.** A stored expiry state needs a nightly
job and is wrong for up to a day every time it runs. `compliance_state` is the
field to act on: it is the stored status, except that a `verified` document
past its date reports `expired`. Expiry outranks verification.

**Nothing is auto-verified.** No OCR, no third-party check, no rule that
accepts a document because its expiry is in the future. `DriverDocumentService`
requires a `User` on every path that reaches `verified`.

**`index` returns every type, held or not.** A driver opening the screen is
asking what they still owe the office; the uploaded subset answers a different
question. An absent type comes back with `document: null`.

**Files are streamed by a controller, never a storage URL** — a signed link to
somebody's identity document is addressable by anyone who ever saw it.
`file_path` is `$hidden` on the model *and* absent from the resource, because
one guard on that is not enough.

**Nothing is gated on a document.** ADR-0033 §6 keeps enforcement out of scope
deliberately; `DriverDocumentService::complianceFor()` is the seam a future rule
consults so there is never a second notion of compliance.

### `me/earnings` — the earnings screen

Reads `driver_ledger_entries` (ADR-0029) over a day, a week or a month, and
returns a total, a breakdown by service type, a trend series and time spent on
trips. Separate from `me/stats` rather than folded into it: stats is polled by
the home screen, while this is opened deliberately, takes a period, and carries
a chart series that a poll would pay for and nobody would read.

Three things about it are worth knowing before changing it.

**"Today" is the driver's local day, not UTC.** Boundaries come from
`settings.regional.timezone` (default `Africa/Kampala`). `config/app.php` sets
the app timezone to UTC, so the `Carbon::now()->startOfDay()` this module used
to call rolled a Kampala driver's day at **03:00 local** — the last two hours
of an evening shift were filed under the previous day. `DriverStatsService` now
takes its boundary from `DriverEarningsService::timezone()` so the two surfaces
cannot disagree about a word they both display.

**Bound Carbon instants must be `->utc()` first.** Laravel binds a Carbon to
SQL by *formatting* it in its own timezone rather than converting, so a
`+03:00` boundary arrives as a UTC wall-clock string and shifts the window
three hours — silently, with every figure still looking plausible. The two
tests that cross a local midnight are what catch it; the ones that do not cross
one passed for the wrong reason before the fix.

**The breakdown always sums to the total, by construction.** Both are folds
over one *un-joined* row set. `order_requests.trip_id` is a nullable FK with no
unique constraint — the `hasOne` is a model convention, not a database
guarantee — so a `LEFT JOIN` to classify entries could multiply a row and
inflate the money. Service types are attached from a second query keyed by
trip. Entries whose trip has no order request are classified `other` rather
than dropped, and `DriverEarningsTest` pins the sum.

### `me/trips` — the trips history screen

The third and last of the `/me` reads, and the set now divides cleanly:
`me/earnings` answers *how much*, `me/ledger-entries` answers *why is my
balance that*, and this answers **what did I actually do**.

**Not `GET /trips` with a filter.** That endpoint is the dispatch board, and
`TripResource` cannot serve either fact this screen turns on: `service_type`
(the All / Rides / Deliveries filter) lives on `order_requests` and is never
joined there, and `driverEarningsFor()` returns null on any list because the
`ledgerEntries` relation is unbounded per row — its own docblock names
`index()` as the reason. Both are one extra query each here, keyed by trip.

Four things are worth knowing before changing it.

**`Trip::forDriver()`, never a plain `where('driver_id', …)`.** `Trip` is
`BelongsToTenant` and `TenantScope` fails closed: with no tenant bound it
appends `1 = 0`, and with one bound it appends `tenant_id = X`, which excludes
every walk-in — a walk-in's `tenant_id` is null by definition. A driver's own
work is mostly walk-ins, so the obvious query returns a plausible, silently
incomplete list. The scope is the named opt-out and mirrors `forCustomer`. The
first test in `DriverTripHistoryTest` exists only to pin this, and removing the
opt-out fails 12 of 16.

**The money is the driver's share, not the gross fare**, read back from the
`fare_earned` ledger entry written at completion. A test asserts that summing
this list equals `/me/earnings` for the same window: two screens about one
driver's pay disagreeing is the worst defect either can carry, and it is
invisible until somebody adds the rows up. `cash_collected` is excluded for the
reason `DriverEarningsService::entries()` gives — summing the pair reports a
finished ride as roughly minus the commission.

**The day headings are computed server-side.** `local_day` and `local_time`
come out in `settings.regional.timezone`, and `meta` carries `today` and
`yesterday` to compare them against. Same UTC-boundary trap as `me/earnings`,
and worse here: on a screen headed "Today" and "Yesterday", a three-hour shift
files an evening's work under the wrong one.

**Cancelled, no-show and rejected trips are included**, with `earned_minor`
null. That is the owner's decision, not an oversight: a driver who drove to a
pickup and was cancelled on has spent the time, and nothing else in the
platform lists that trip. Null and never `0` — `docs/screen-rules.md` §1: a
zero reads as a job done for free.

### Tips and bonuses (ADR-0034)

Both were refused three times, correctly, and the owner has now had them
built. The refusals were about what the platform *could* produce; this is a
decision about what it *should*.

**A tip is declared by the driver and confirmed by the office**, reusing
ADR-0032's pipeline as a third `SettlementRequestKind`. It is the only kind
that carries `trip_id`, so its one-open-request rule is **per trip** rather
than per kind — a driver who took three tips in a day has three real
declarations. The trip is checked to be that driver's own in the controller,
not the form request: `exists:trips,id` proves only that a trip is real, and a
confirmed tip writes a credit.

**A tip is commissionable**, which is the owner's ruling and the one that
decided the data model. It means a tip behaves exactly like a fare and reuses
the pair that already makes the balance work:

```
tip 2,000 at 20%
  tip_earned          + 1,600
  tip_cash_collected  − 2,000
  ---------------------------
  balance               −  400
```

`tip_cash_collected` is a fourth kind rather than a second `cash_collected`
row because `(trip_id, kind)` is unique — the index that stops a retried
completion paying twice. The alternative model, where a driver keeps the whole
tip, creates **no obligation in either direction**: its effect on the balance
is zero, so it could not be a ledger entry at all and would have needed its own
table and been absent from the wallet statement. Same feature, different build.

**A bonus is an automatic weekly trip target**, awarded by
`drivers:award-weekly-bonuses` over a **closed** week — never the one in
progress, because a partial week cannot be measured against a weekly target
and a bonus that later un-awards itself is a lie about money. It is
**unpaired**: not cash in anybody's hand, so the balance moves by the whole
amount. No commission is taken — the advertised figure and the paid figure
must not differ.

Three properties worth knowing before changing any of it:

- **`billing.bonus_enabled` defaults to false.** It creates a liability
  against every driver on the platform, and a scheme that switches itself on
  at deploy is an unbudgeted bill. Same argument as `maps.routing_enabled`.
- **The target and the amount live in settings and are written into the entry
  that awards them.** Both are admin-settable, so an award explained only by
  "the current target" is one nobody can defend a year later. The driver app
  is told neither figure.
- **Idempotency is a unique index on `(driver_id, week_start)`**, and the
  awarding code catches the violation rather than pre-checking. A cron can fire
  twice — overlapping a deploy, re-run after a failure, two app servers — and
  paying payroll twice is the error nobody notices until reconciliation.
  Re-running by hand is therefore safe, and `--week=` exists for it.

`DriverEarningsService` sums `LedgerEntryKind::earnings()` — the three credit
kinds — rather than `fare_earned` alone, and groups tips and bonuses **by kind
ahead of service type**, so a tip is never folded into the Rides row of the
trip it was given on and a bonus is not filed as unclassifiable work.

### `me/ledger-entries` — the wallet statement

The rows behind `wallet_balance_minor`. That field says *what* the balance is;
this says **why**, which is the only question a driver actually has about it.
Cursor-paginated at 25 on the house pattern (`TripEventController`).

**Ordered by `id`, not `created_at`.** The pair written at completion shares a
timestamp to the second, so a cursor over the timestamp alone has an undefined
order within the pair and can skip or repeat a row across a page boundary.
There is a test for it.

**Every entry is served, `cash_collected` included.** Serving only the credits
would produce a prettier list that does not sum to the balance it sits under —
and the balance is the thing this endpoint exists to explain.

**`service_type` does not come from an eager-loaded relation, and cannot.**
The obvious `->with('trip.orderRequest')` returns nothing here, silently:
`Trip` is `BelongsToTenant` and `TenantScope` *fails closed*, appending
`1 = 0` when no tenant is bound rather than risking a cross-tenant leak. A
driver on a walk-in has no tenant context, so every row would lose its label
with no error anywhere. The controller reads `order_requests` through the
query builder instead, unscoped and keyed by trip — the same shape
`DriverEarningsService` uses, and for the same second reason: `trip_id` there
has no unique constraint, so a join could multiply a row.

**Read-only, and there is deliberately no counterpart write.** ADR-0029 §6
keeps the platform recording money rather than moving it — no gateway, no
payout, no top-up. `settlement` rows are the office's to write, and the
console screen that would write them **does not exist yet**; that is the
standing gap this module has carried since ADR-0029, and it is now visible to
drivers on a screen that shows what they owe.

### Settlement requests (ADR-0032) — the loop ADR-0029 §6 left open

§6 said the office would write `settlement` entries when cash changed hands.
Nothing ever could: `recordSettlement()` had no caller outside a seeder, so no
settlement was ever recorded and every balance only ever moved one way. A
driver could see what they owed and had no way to tell anyone they had paid it.

**A driver raises a request; the office confirms it; the confirmation writes
the ledger entry.** Money still does not move through this platform — cash
changes hands at the depot exactly as before. Two kinds, mirroring the ledger's
two directions: `remittance` ("I have handed you cash", credits the driver) and
`payout` ("please pay me"). Neither is called deposit or withdrawal, because a
driver is not depositing into an account this platform holds.

Four properties hold this together, and each has a test:

- **A pending request is never a balance.** The wallet total comes from
  `driver_ledger_entries` alone. If a request moved it, a driver could request
  their way out of what they owe.
- **Confirming is idempotent.** The row is locked and re-read *inside* the
  transaction, and `ledger_entry_id` records what it produced — so a double-tap
  or a retried request returns the original rather than paying twice. This is
  the one endpoint here where a lost race means real money.
- **The amount is stored positive whatever the kind.** A person typing an
  amount does not type a sign; the direction is `kind`, and
  `SettlementRequestKind::ledgerSign()` derives the entry's sign — so a wrong
  sign in this table cannot become a wrong sign in the ledger.
- **One open request per kind**, held under a lock rather than a unique index:
  the constraint is "at most one *pending*", which MySQL 8 cannot express as a
  partial index.

Confirming writes through `DriverLedgerService::recordSettlement()` and never
by inserting a row, so the sign convention stays in one place.

**Still missing: the console screen.** The office can act only through the API.
That is a smaller gap than the one it replaces — before this, nothing anywhere
could record a settlement — but it is the next thing to build, and ADR-0032's
Consequences says so.

**Absent by design, not pending:** tips, bonuses and online hours. Neither tips
nor bonuses exist anywhere on this platform. Online hours cannot exist —
`driver_presence` is one row per driver, upserted on every duty toggle, so the
previous state is destroyed and no history was ever kept; `driver_shift_windows`
is a roster, not a timesheet. `on_trip_minutes` is offered instead and is a
different, smaller figure: time driving, which excludes waiting for a job.

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
