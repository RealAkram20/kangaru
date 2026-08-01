# Reports

## Purpose

The artifact the anchor client judges the platform by. PROJECT.md's
requirement is a system "capturing **and reporting**" six data points per
trip, so a trip that is recorded but not reportable does not satisfy it.

All four of PROJECT.md's Phase 1 reports — trip, driver, vehicle and
financial — are now here.

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
- `FinancialActivityRepository` / `FinancialReportSource` — the financial
  report. The first source that reads `Modules/Billing` rather than
  `Modules/Trips`, and the first whose rows are periods rather than things.
  Neither mattered to the pipeline: implementing `ReportSource` was the
  whole of the work, and the three writers, the row-ceiling check and the
  queued export job picked it up unchanged.
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

## The financial report

`GET /api/v1/reports/financial`. One row per period in which anything was
invoiced or credited: period, invoice count, invoiced, credit-note count,
credited, and the net of the two.

Filters are `from`, `to` and `group_by` (`day` | `week` | `month` |
`year`, default `month`) — PROJECT.md's "daily, weekly, monthly and annual"
cadence, applied to the one report where a period is the row rather than a
filter. It takes none of the trip report's filters and the fleet reports
take none of its, which is why each has its own request class rather than
sharing one whose whitelist would be the union of all three.

Ordered oldest first, unlike the fleet reports' busiest-first: a ledger is
read forwards, and a running total that goes backwards in time is not one a
finance user can follow down the page.

### "Outstanding" means issued less credited

Nothing in this platform records money coming in — payments, statements and
credit limits are all deferred (`Modules/Billing/README.md`, deferred item
1). So `outstanding_minor` here cannot mean "unpaid", and a bank reading it
that way would be reading a number the system cannot produce.

That caveat is stated in three places, deliberately: the
`payments_recorded: false` flag on the JSON summary, a **Basis** line in the
XLSX and PDF headers, and the hint under the on-screen tile — all driven by
the one flag, so the day payments land they correct themselves rather than
becoming a stale warning. A caveat that lives only in a tooltip is absent
from the document someone actually files.

### Which period a credit note falls in

Its own `issued_at`, not that of the invoice it corrects. A credit note
raised in August against a July invoice belongs to August: that is when the
correction was made, when the ledger moved, and where a finance user
reconciling August will look for it.

The consequence, and it is worth being explicit about: **a row is a
statement about activity in that period, not about the eventual fate of the
invoices raised in it.** July's row does not shrink when August credits a
July invoice. A cohort view — "of what we invoiced in July, how much came
back?" — is a different report and is not built.

A period whose credit notes exceed its invoicing has a negative net. That
is not clamped: a month that only corrected earlier work really did reduce
receivables, and flooring it at zero would hide exactly the correction the
report exists to show.

### Money in the columns

The three money columns carry whole shillings as **numbers**, not formatted
strings — this is a column people sum in a spreadsheet, and `UGX 1,250,000`
in a cell is a value nobody can add up. The currency is in the header
instead. Minor units are exact because Phase 1 is UGX, which is
zero-decimal (AGENTS.md: one minor unit is one shilling); `FinancialReportSource::rows()`
is one of the places that has to divide the day multi-currency lands.

Two queries are merged by bucket key rather than joined. Invoices and credit
notes are separate documents with separate dates, and joining them would
repeat an invoice's amount once per credit note raised against it — the
classic fan-out, which on a financial aggregate does not look like a
duplicated row, it looks like a larger figure.

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
- `Modules\Billing\Models\{Invoice, CreditNote}` — the financial report
  only, and read-only. Reports depends on Billing; Billing does not depend
  on Reports.
- `App\Support\Money\Shillings` — every monetary figure is a
  `Brick\Money\Money` from the moment it leaves the database until it is
  written to a cell, per AGENTS.md's rule against raw integer math on money.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode::REPORT_TOO_LARGE`.

## Public APIs

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/v1/reports/trips` | `viewReports` gate — the on-screen report |
| GET | `/api/v1/reports/drivers` | `viewReports` gate |
| GET | `/api/v1/reports/vehicles` | `viewReports` gate |
| GET | `/api/v1/reports/financial` | `viewReports` gate |
| POST | `/api/v1/reports/exports` | `viewReports` gate — request a file; `202` |
| GET | `/api/v1/reports/exports` | `viewReports` gate — this tenant's recent exports |
| GET | `/api/v1/reports/exports/{id}` | `viewReports` gate — poll until `is_terminal` |
| GET | `/api/v1/reports/exports/{id}/download` | `viewReports` gate |

`viewReports` is a **Gate**, not a Policy: a report is not a model, and
AGENTS.md names Gates alongside Policies. Drivers and Corporate Employees
are excluded — a report spans the tenant's whole fleet, which is more than
either should see.

Filters are whitelisted **per report**; anything else is a 422, never a
silent ignore:

| Report | Accepts |
|---|---|
| trips | `from`, `to`, `vehicle_id`, `driver_id`, `status` |
| drivers, vehicles | `from`, `to` |
| financial | `from`, `to`, `group_by` |

A bare `to` date covers the whole of that day — "1st to 31st" must include
the 31st, not stop at its first second. Every report applies the same rule,
or the same range would produce different totals depending on which one you
opened.

`POST /reports/exports` stands in for all four reports, so its validation
rules are necessarily the union of their filters — and it therefore needs
its own per-report check, which it did not have before the financial report
arrived. Asking for a driver export filtered to one vehicle used to be
accepted and then dropped, producing a file that reported every driver while
the request that produced it said otherwise. `RequestExportRequest` now
refuses it, and only the accepted filters are persisted to
`report_exports.filters` — that row is the audit record of what was asked
for, and a filter recorded there that had no effect on the file would be a
lie in the audit trail.

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

1. **Payments, and therefore a true "outstanding".** The financial report's
   outstanding figure is issued-less-credited because nothing in the
   platform records money coming in (`Modules/Billing`, deferred item 1).
   Ageing buckets (30/60/90 days), statements and per-client balances all
   wait on the same thing. The report says so on every surface rather than
   letting the number be misread.
2. **A per-client financial breakdown.** The report totals the tenant, not
   its companies or cost centres. `Modules/Clients` has both, and invoices
   reach a company through `trip -> booking`, so this is a join and a
   `group_by` away — but it is a second grouping axis on top of the period
   one, and pairing them is a design question (rows per client per month?
   a client filter?) rather than a mechanical addition.
3. **A cohort view.** Rows report activity *in* a period. "Of what we
   invoiced in July, how much has since been credited?" is a different
   question, needs credit notes grouped by their invoice's date rather than
   their own, and would be a second report rather than a flag on this one —
   two numbers under one heading is how a report gets misread.
4. **Dense period rows.** Only periods with activity produce a row, so a
   month in which nothing was invoiced is absent rather than shown as zero.
   Densifying needs a bounded range, and `from`/`to` are both optional.
5. **Thousands separators in PDF table cells.** The summary block above the
   table reads `UGX 198,000`; the cells below read `198000`. The rows are
   shared with CSV and XLSX, where a formatted string would be unsummable,
   so the fix belongs in `reports/table-pdf.blade.php` — but that template
   also renders the trip report, which is the Bank's acceptance artifact,
   and number_format'ing every numeric cell would round the distance column
   to whole kilometres. It needs a decimals-aware rule, not a one-liner.
6. **Scheduled reports** — the daily, weekly, monthly and annual *cadences*
   PROJECT.md asks for exist as a `group_by` on the financial report, but
   nothing runs a report on a schedule.

   Being *told* an export is ready is now built: `GenerateReportExport`
   dispatches `ReportExportCompleted` once the row is `completed` and the
   file is on disk, and `Modules/Notifications` files an in-app
   notification for the requester. Polling is no longer the only way to
   find out. A **failed** export still notifies nobody, deliberately — it
   already appears on the export list with its reason, and telling someone
   a thing they are watching has failed adds noise, not information. That
   changes when exports can be scheduled, because then nobody is watching.
7. **Cursor paging in the UI** — the trip report's API is cursor-paginated
   and returns `meta.cursor.next`, but `ReportsPage` renders only the first
   page. The exports cover the full filtered set regardless. The three
   aggregate reports are unpaginated by design and are unaffected.
8. **Odometer-vs-GPS variance column** — the trip report shows odometer
   distance only. `gps_distance_km` stays null until the ADR-0003 pipeline
   exists.
9. **PDF pagination of very large reports** — the ceiling avoids the memory
   problem rather than solving it. A chunked or paginated PDF writer would
   lift it; nothing needs that yet. The financial report cannot reach the
   ceiling anyway: bucketing bounds it at 366 rows for a year grouped daily.

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

`FinancialReportTest` builds every figure it asserts by raising real
invoices through `InvoiceService` against trips walked through the real
state machine. An `invoices` row written directly would carry a total no
rate card produced and a number the locked counter never allocated — it
would prove nothing about a report whose whole job is to total what billing
actually issued. It stamps `issued_at` afterwards, via `toBase()` so
`TenantScope` still applies, because the report buckets on that column and
a suite that depended on the wall clock would fail once a month.

### The tenancy guard was verified by removing it

`FinancialActivityRepository::bucket()` ends in `->toBase()`. The
neighbouring `->getQuery()` looks equivalent, returns the same class, and
silently drops every global scope — including `TenantScope`.

Swapped for `getQuery()`, "it never totals another tenant's money into this
one" fails with `Failed asserting that 4 is identical to 2`. Worth noting
what *didn't* fail: `assertJsonCount(1, 'data')` still passed, because both
tenants' invoices bucket into the same month and the leak merges into the
existing row. A test asserting row counts alone would have gone straight
through it. That is the whole reason the isolation tests in this module
assert on totals — a leak in an aggregate is not a stray row, it is a
bigger number.

Re-run that check if you touch this repository.

## Frontend

`frontend/src/pages/ReportsPage.tsx` (report picker, filters, trip KPIs and
rows) and `frontend/src/pages/reports/ExportPanel.tsx` (format buttons,
export list, download).

The three aggregate reports each render their own headline figures —
`reports/FleetReport.tsx` for drivers and vehicles,
`reports/FinancialReport.tsx` for the financial one — over a shared
`reports/PositionalReportTable.tsx`. That table was extracted when the
financial report became the second report of its shape (AGENTS.md: "if a
component appears more than once, convert it into a reusable component").
It builds its columns from `meta.headers` and decides alignment from the
cell's runtime type, so a report that gains a figure gains it on screen
without a frontend change.

Numeric cells are thousands-separated there rather than per report. The
financial report is why — `35000` and `350000` are hard to tell apart at a
glance, and money is where that misreading is expensive — but it applies by
type rather than by column, so it needed no per-report configuration and
the fleet reports get it too.

The export list shows the report's own name and its server-supplied row
noun (`row_noun`). It previously said "trips" for every export, which was
already wrong for the driver and vehicle reports and would have read as
nonsense against a financial one.

The panel polls only while an export is unfinished and stops as soon as
everything is terminal — an idle report page makes no requests. Downloads
go through the API client rather than a plain link so the bearer token is
attached; the routes sit behind `auth:sanctum` like everything else.
