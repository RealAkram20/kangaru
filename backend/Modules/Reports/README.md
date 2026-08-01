# Reports

## Purpose

The artifact the anchor client judges the platform by. PROJECT.md's
requirement is a system "capturing **and reporting**" six data points per
trip, so a trip that is recorded but not reportable does not satisfy it.

This pass delivers the **trip report**. Driver, vehicle and financial
reports (PROJECT.md Reports) follow.

## Responsibilities

- `TripReportRepository` — the report query and its aggregates. A
  repository because ADR-0002 requires one for "non-trivial queries
  (joins, aggregates, geospatial, reporting)"; this is all three, and both
  the paginated view and the CSV export run it.
- `TripReportCsv` — streamed CSV export.
- `TripReportRowResource` — one row, flatter than `TripResource`: a report
  row is read across, and nesting vehicle and driver objects would push the
  registration number and driver name a level below where a reader looks.

## The six criteria

Every row carries all six, in PROJECT.md's order:

| # | Criterion | Field |
|---|---|---|
| 1 | Date and time of commencement and completion | `commenced_at`, `completed_at` |
| 2 | Vehicle registration details | `vehicle_registration`, `vehicle_description` |
| 3 | Trip origin and destination | `origin`, `destination` |
| 4 | Opening and closing odometer readings | `odometer_start`, `odometer_end` |
| 5 | Total distance travelled | `distance_km` |
| 6 | Trip duration | `duration_minutes` |

`is_complete` states whether a row actually carries all six, so a deficient
record is flagged rather than left as blanks a reader has to notice.

## Two deliberate decisions

**Trips that never commenced are excluded.** A trip cancelled before
`Trip Started`, rejected, or marked no-show has no "date and time of trip
commencement" — the first required column. Listing it with an empty first
column would misrepresent the report, so the query filters on
`started_at IS NOT NULL`.

**Completeness is `null`, not 100%, when nothing has completed.**
PROJECT.md's success metric is "all six data points present on 100% of
completed trips". Over an empty set that percentage is undefined, and
inventing 100% would read as a pass in exactly the review where it matters.
An in-flight trip is reported as in progress, not as a deficient record.

## Dependencies

- `Modules\Trips\Models\Trip` — the report is built on the Eloquent model,
  not the query builder, so ADR-0001's `TenantScope` applies automatically.
  A raw `DB::table('trips')` here would report every tenant's trips, which
  for a bank client is the worst bug this platform can have.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode::REPORT_TOO_LARGE`.

## Public APIs

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/v1/reports/trips` | `viewReports` gate |
| GET | `/api/v1/reports/trips/export` | `viewReports` gate — streamed CSV |

`viewReports` is a **Gate**, not a Policy: a report is not a model, and
AGENTS.md names Gates alongside Policies. Drivers and Corporate Employees
are excluded — a report spans the tenant's whole fleet, which is more than
either should see.

Filters (whitelisted; anything else is a 422): `from`, `to`, `vehicle_id`,
`driver_id`, `status`. A bare `to` date covers the whole of that day —
"1st to 31st" must include the 31st, not stop at its first second.

`meta.summary` is computed over the **whole filtered set**, not the current
page: a total distance covering only the visible rows would be read as the
month's figure and be wrong.

## What's explicitly deferred

1. **Excel (.xlsx) and PDF export** — AGENTS.md requires PDF, Excel and
   CSV. Only CSV ships here; it needs no dependency and opens in Excel, but
   it is not a formatted Excel workbook and is certainly not a PDF. Both
   need a package (`openspout`/PhpSpreadsheet, dompdf) and belong with the
   queued exporter below rather than bolted onto a synchronous request.
2. **Queued generation** — AGENTS.md: "Reports generate asynchronously via
   queue; nothing over 3 s blocks a request." The CSV is streamed, so bytes
   start moving immediately and memory stays flat, but it still occupies a
   PHP-FPM worker for the duration. `TripReportCsv::EXPORT_ROW_LIMIT`
   (50,000) is the stopgap: past it the request is refused with
   `REPORT_TOO_LARGE` and advice to narrow the range, rather than
   truncating silently — a short report is a billing dispute. At the
   target 10,000 trips/day a full month exceeds this, so the queued
   exporter is required before the first month-end, not optional.
3. **Driver, vehicle and financial reports** — only the trip report exists.
   Financial reporting waits on `Modules/Billing`.
4. **Scheduled/emailed reports** — daily, weekly, monthly and annual
   cadences (PROJECT.md) are not built; `Modules/Notifications` is empty.
5. **Cursor paging in the UI** — the API is cursor-paginated and returns
   `meta.cursor.next`, but `ReportsPage` renders only the first page.
6. **Odometer-vs-GPS variance column** — the report shows odometer distance
   only. `gps_distance_km` stays null until the ADR-0003 pipeline exists.

## Notes

`TripReportCrossTenantIsolationTest` is the AGENTS.md-mandated,
non-skippable isolation proof. It exists separately from the Trips one
because a report is an **aggregate**: a leak here would not show up as a
stray row in a list but as another tenant's distance and trip count
silently inflating this tenant's totals — invisible unless the summary is
asserted directly, which that test does.

Fixtures in `tests/Feature/Reports/` build trips by walking the real state
machine. A `Trip` row written straight to a completed status would carry
odometer and timestamp values no transition ever set, and would prove
nothing about the report.
