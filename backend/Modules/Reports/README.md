# Reports

## Purpose

The artifact the anchor client judges the platform by. PROJECT.md's
requirement is a system "capturing **and reporting**" six data points per
trip, so a trip that is recorded but not reportable does not satisfy it.

This pass delivers the **trip report**. Driver, vehicle and financial
reports (PROJECT.md Reports) follow.

## Responsibilities

- `ReportSource` — what a report *is*: a title, a column list, a row
  generator, a summary and a row count. Every writer, the on-screen
  endpoint and the pre-queue size check all read the same one, so the
  spreadsheet and the screen cannot disagree about a column or a total.
  `ReportSourceFactory` maps a `ReportType` to its implementation.
- `TripReportRepository` / `TripReportSource` — the trip report query and
  its aggregates. A repository because ADR-0002 requires one for
  "non-trivial queries (joins, aggregates, geospatial, reporting)"; this is
  all three.
- `FleetActivityRepository` / `FleetActivitySource` — the driver and
  vehicle reports: the same aggregate over trips, grouped by whoever or
  whatever did the work. One source class for both, because separating them
  would duplicate every figure so that two headers could differ.
- `ReportExport` + `GenerateReportExport` — file output, produced on a
  queue (AGENTS.md: "Reports generate asynchronously via queue; nothing
  over 3 s blocks a request"). The request records the intent and returns
  `202`; the file appears when the worker finishes.
- `TripReportRowMapper` — the single definition of the trip report's
  columns. Three writers each with their own column list would drift, and
  the format a client happened to open would decide whether they saw all
  six required data points.
- `CsvReportWriter`, `XlsxReportWriter`, `PdfReportWriter` — one per
  format behind `ReportWriter`, each generic over the report. They take a
  `ReportSource` as an argument rather than a constructor dependency,
  because which report they are rendering is decided per job.
- `PruneReportExports` — scheduled daily; deletes expired files.
- `TripReportRowResource` — one row, flatter than `TripResource`: a report
  row is read across, and nesting vehicle and driver objects would push the
  registration number and driver name a level below where a reader looks.

## The driver and vehicle reports

`GET /api/v1/reports/drivers` and `/reports/vehicles`. One row per driver
or vehicle that commenced a trip in the period, ordered by distance so the
row that matters most is read first.

Neither is paginated: a tenant has tens of drivers, not tens of thousands,
and a cursor over a `GROUP BY` would cost more than it saved. The trip
report, which is row-per-trip, keeps its cursor.

They take **only** `from` and `to` (`FleetReportRequest`). Reusing
`TripReportRequest` would have accepted `vehicle_id`, `driver_id` and
`status` and quietly ignored them — reporting every driver while claiming
to report one vehicle's, which is exactly the silence AGENTS.md's
whitelist rule exists to prevent.

Only trips that actually commenced are counted. A booking cancelled before
anyone drove it is not work a driver did.

Column headers travel with the rows in `meta.headers`, and the frontend
renders from them rather than holding its own list. A report that gains a
figure gains it on screen, in the CSV, in the workbook and in the PDF
without a frontend change — and the failure mode a client-side copy
produces is a correctly-populated table under the wrong headings.

`FleetReportTest` asserts the driver and vehicle totals agree with each
other: the same three journeys grouped two ways must sum the same, or one
of the reports is wrong. It also asserts the cross-tenant case directly,
because a leak in an aggregate is not a stray row — it is a bigger number,
invisible unless the total is checked.

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
| GET | `/api/v1/reports/trips` | `viewReports` gate — the on-screen report |
| POST | `/api/v1/reports/exports` | `viewReports` gate — request a file; `202` |
| GET | `/api/v1/reports/exports` | `viewReports` gate — this tenant's recent exports |
| GET | `/api/v1/reports/exports/{id}` | `viewReports` gate — poll until `is_terminal` |
| GET | `/api/v1/reports/exports/{id}/download` | `viewReports` gate |

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

## Exports

All three formats AGENTS.md requires — CSV, Excel and PDF — generated on
the queue and stored under `tenants/{id}/reports/{export}/` (ADR-0001).

CSV and XLSX are written **row by row to a file handle**, so memory stays
flat whatever the volume; `openspout` was chosen over PhpSpreadsheet
precisely because it streams, and PhpSpreadsheet holding a whole sheet in
memory is the failure this exporter exists to avoid.

PDF is different: dompdf assembles the document in memory before
rendering, so it declares a row ceiling (`config/reports.php`,
default 5,000). Above it the request is refused up front with
`REPORT_TOO_LARGE` and advice to narrow the range or pick another format —
never truncated, because a silently short report is a billing dispute, and
never queued to die halfway, because a spinner with no explanation is
worse than a clear refusal.

Files expire after `reports.export.retention_days` (default 7) and
`reports:prune-exports` runs daily to delete them. The **row survives the
file**: that a report was taken, by whom and when, is exactly what a bank
audit asks about, so pruning clears `path` rather than deleting the record.

The queue driver is `database`, so a worker must be running
(`php artisan queue:work`) for exports to complete outside of tests, where
`QUEUE_CONNECTION=sync` runs them inline.

## What's explicitly deferred

1. **The financial report** — PROJECT.md's fourth. It reads invoices and
   credit notes rather than trips, so it is a new `ReportSource` over
   `Modules/Billing` rather than another grouping of the fleet aggregate.
   Now cheap to add: the pipeline it would plug into is generic.
   Financial reporting waits on `Modules/Billing`.
2. **Scheduled/emailed reports** — daily, weekly, monthly and annual
   cadences (PROJECT.md) are not built; `Modules/Notifications` is empty.
   The export exists but nobody is told when it is ready except by the page
   polling.
3. **Cursor paging in the UI** — the API is cursor-paginated and returns
   `meta.cursor.next`, but `ReportsPage` renders only the first page. The
   exports cover the full filtered set regardless.
4. **Odometer-vs-GPS variance column** — the report shows odometer distance
   only. `gps_distance_km` stays null until the ADR-0003 pipeline exists.
5. **PDF pagination of very large reports** — the ceiling avoids the memory
   problem rather than solving it. A chunked or paginated PDF writer would
   lift it; nothing needs that yet.

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

The export tests assert on real output rather than a mocked writer: the
XLSX test checks the file begins with the `PK` zip magic (a renamed CSV
would not), and the PDF test checks for `%PDF-`. `QUEUE_CONNECTION=sync`
under `phpunit.xml` is what makes that possible in-process.

## Frontend

`frontend/src/pages/ReportsPage.tsx` (filters, KPIs, rows) and
`frontend/src/pages/reports/ExportPanel.tsx` (format buttons, export list,
download).

The panel polls only while an export is unfinished and stops as soon as
everything is terminal — an idle report page makes no requests. Downloads
go through the API client rather than a plain link so the bearer token is
attached; the routes sit behind `auth:sanctum` like everything else.
