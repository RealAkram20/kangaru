# ADR-0007: Reporting Scope for Platform Staff

**Status:** Accepted (3 August 2026)

**Resolves:** the consequence ADR-0006 named and deliberately did not
solve — "Reports and exports need a tenant decision."

**Depends on:** ADR-0006 (Accepted). Platform staff exist, read across
tenants through `forActor()`, and write into the subject's tenant.

## Context

ADR-0006 gave Shanitah's own staff a working cross-client view of
bookings, trips and invoices. It did not give them reports, and said so:

> A platform user running a trip report has no tenant to scope it to.
> Either the report gains a tenant filter or it spans all clients; a
> monthly invoice run must not silently become cross-client.

That is now the largest remaining hole in the platform view, and it is
visible rather than theoretical. Measured against the demo seed on
2 August 2026, every one of PROJECT.md's four Phase 1 reports answers
`200` with **zero rows** for a platform account:

| Account | trips | drivers | vehicles | financial |
|---|---|---|---|---|
| `admin@centenarybank.test` (tenant) | 26 | 7 | 7 | 4 |
| `superadmin@kangaruride.test` | **0** | **0** | **0** | **0** |
| `finance@kangaruride.test` | **0** | **0** | **0** | **0** |

Empty, not broken — the repositories build on Eloquent models, so
`TenantScope` fails closed exactly as designed. A Super Admin sees an
operating platform everywhere else and four blank reports.

### Why this is not simply "another `forActor()`"

Bookings and trips are **rows**. Adding a client's rows to a list changes
what is in the list, and a `tenant` column would say which is which.

Reports are **aggregates**, and that makes cross-client spanning
qualitatively different:

- `reports/drivers` and `reports/vehicles` aggregate over the **platform
  fleet**, which since ADR-0005 is shared. A driver's utilisation summed
  across every client is arguably the *correct* platform figure and
  certainly not a per-client one. These two may not want a tenant scope at
  all.
- `reports/financial` groups **money by period**. Summing Centenary Bank's
  revenue with another client's into one "Total invoiced" row is not a
  wider report, it is a **different and misleading number** — and it is the
  number a bank is shown on a projector.
- `reports/trips` is the one that carries the Bank's six acceptance
  criteria (PROJECT.md). It is row-shaped and behaves like the trips list.

So "open the reports to platform staff" is three different decisions
wearing one name. A single `forActor()` on all four would silently produce
a cross-client revenue total, which is precisely the failure ADR-0006
warned about in its own Consequences.

### The export path multiplies it

`POST /reports/exports` writes a `ReportExport` row, which is
`BelongsToTenant`. A platform actor has no tenant, and unlike every write
in ADR-0006 there is **no subject record to bind** — `BindSubjectTenant`
has nothing to read, because an export request names a report type and a
date range, not a record. The write would produce a tenant-less export or
a foreign-key failure.

**Measured 3 August 2026: it is the foreign-key failure, and it reaches the
user as a `500`.** A platform Finance officer posting a financial export
gets `SQLSTATE[23000]: Column 'tenant_id' cannot be null` thrown out of the
insert. With `APP_DEBUG=false` the error handler catches it and returns the
correct envelope — `{"success":false,"code":"SERVER_ERROR", ...}` with no
SQL, no host and no database name — so this is **not** an information
disclosure, and AGENTS.md's "never expose raw exceptions" rule is being
honoured. It is still an unhandled integrity violation behind a button on
the Super Admin demo path.

That distinction matters for sequencing: the export is not merely
*unscoped pending this decision*, it is **broken today**, and rule 4 is
therefore a defect fix as much as a scoping change. Even had this ADR been
rejected outright, the endpoint would owe the actor a clean refusal rather
than a 500.

The notification that follows ("your export is ready") is tenant-scoped
for the same reason, which is why a platform user's inbox is empty today.
Reports, exports and notifications are one problem, not three.

## Decision

**Taken by the owner on 3 August 2026: the recommendation below, with one
amendment — rule 1 refuses a client's `tenant_id` rather than ignoring it.**

The sharp edge (rule 2) was put as a direct choice — refuse the unfiltered
cross-client total with `422`, or produce it with a label — and the refusal
was chosen. The reasoning that settled it is recorded in rule 2.

### An explicit, required tenant selection for money; spanning for the fleet

1. **`reports/trips` and `reports/financial` gain an optional
   `tenant_id` filter, honoured only for platform staff.** A client's user
   supplying it is **refused with `422`, not ignored** — they have exactly
   one tenant and it is not a parameter they get to choose.

   *Amended from the proposal, which said "ignored".*
   AGENTS.md is explicit that unknown filters "return 422, not silence".
   The endpoint already behaves this way — verified 3 August 2026, a client
   passing `tenant_id` gets `VALIDATION_FAILED` / *"tenant_id" is not a
   filter this report accepts* — so ignoring would be a deliberate
   regression to a weaker contract. And silence is the dangerous failure
   mode: a client who passes `tenant_id=2`, gets their own data back and is
   told nothing has no way to know the parameter was dropped, so the day
   the predicate is inverted they get somebody else's data with no signal
   that anything changed. Refusing loudly also gives the new isolation test
   an unambiguous assertion — a status code, not the absence of a row.

2. **For `reports/financial`, `tenant_id` is _required_ when the actor is
   platform staff.** An omitted filter returns `422`, not a cross-client
   total. Refusing to answer is better than answering with a figure whose
   meaning nobody agreed: "all clients' revenue this month" is a real
   question, but it is a **platform P&L**, not the client-facing financial
   report this endpoint is, and it deserves its own endpoint rather than
   the same one behaving differently depending on who asked.

   The counter-proposal was to produce the total with `meta.scope` and a
   header naming it. Rejected on two grounds. First, **this report exports
   to PDF.** A label on screen survives; a PDF gets forwarded, cropped and
   screenshotted into a deck, and a number that is only correct while its
   label is attached will eventually appear without it, in front of a bank.
   Rule 5 makes the label as good as a label can be, and for a figure like
   this one that is still not good enough. Second, the refusal is the
   **reversible** choice: if Shanitah turns out to need a platform P&L, it
   arrives as a new endpoint and nothing already shipped changes meaning.
   Producing the total is not reversible — by the time it is reconsidered
   the number is in somebody's inbox.

3. **`reports/drivers` and `reports/vehicles` span every client for
   platform staff, with no filter.** They aggregate a shared fleet
   (ADR-0005); per-client utilisation of a pooled vehicle is the less
   meaningful figure, and the platform-wide one is what an operations
   manager actually needs.

4. **Exports carry the resolved tenant explicitly.** `ReportExport` gains
   the tenant the export was run *for*, chosen by rule 1/2 rather than
   inherited from the actor. A platform export of a client's financial
   report is that client's export and belongs in their tenant, which also
   fixes the notification.

5. **Every report response states its scope**, the way
   `/audit-logs` already returns `meta.scope`. A report that spans clients
   must say so on screen and in the exported file header. An exported PDF
   that does not name whose figures it contains is the document that ends
   up in the wrong meeting.

### What this deliberately does not do

- **No platform P&L report.** Rule 2 refuses the cross-client total rather
  than inventing the endpoint that should serve it. That is new product
  scope, not a scoping fix.
- **No account switcher.** ADR-0006 rejected per-request tenant switching
  as the *primary* mechanism and called it "genuinely good for Finance and
  support, and worth having later". A filter parameter is not that feature
  and does not preclude it.

## Consequences

**`Gate::viewReport` stays exactly as it is.** ADR-0006's rule holds:
`tenant_id` being null answers *whose*, permissions answer *what*. Commit
`83744fa` already gated each report on the data it exposes — a Dispatcher
is refused `reports/financial` and that must remain true whether they are a
client's dispatcher or Shanitah's. Verified as still holding on
2 August 2026.

**Three repositories, seven methods, change signature** — taking the actor
the way `InvoiceRepository::listing()` now does. All currently take only
`$filters`: `TripReportRepository::query()` and `::summary()`,
`FleetActivityRepository::byDriver()`, `::byVehicle()`, `::countByDriver()`
and `::countByVehicle()`, and `FinancialActivityRepository::byPeriod()`.
The two `count*` methods are the easy ones to miss, and a paginated report
whose total was computed under a different scope than its rows is a bug
that looks like an off-by-one.

**The isolation suite gains a third obligation.** ADR-0006 added the mirror
(platform staff see nothing they lack permission for). This adds: a
platform actor's report, filtered to one tenant, contains **only** that
tenant — and a client's user supplying `tenant_id` for somebody else's
tenant is **refused with `422`** rather than obeyed. That second one is the
new escalation surface this ADR creates and the test that must exist before
it ships.

Per AGENTS.md's rule that a safety-critical test must be proved to fail
without the thing it guards: the escalation test is to be written, the
`tenant_id` authorization check then removed, the test observed going red,
and the check restored. A test that passes because the filter was never
honoured for anybody proves nothing — and that is the vacuous pass this
project has already shipped once, in a race test.

**`records_incomplete` becomes ambiguous across clients.** The trip
report's completeness figure is measured against PROJECT.md's success
metric "all six data points on 100% of completed trips". Spanning clients
makes it a platform average, which is not what that metric means. Rule 1
keeps it per-client whenever a filter is supplied; unfiltered, it needs a
label.

## Alternatives considered

**One `forActor()` on all four repositories.** Consistent with ADR-0006 and
about six lines. Rejected: it produces a cross-client revenue total with no
label, which is the specific outcome ADR-0006's Consequences warned
against. Consistency of mechanism is not a good enough reason to ship a
misleading number to a bank.

**Leave reports tenant-only; platform staff simply have none.** Honest,
zero risk, and the status quo. Rejected because it makes the Super Admin
account permanently unable to answer "how did Centenary Bank's fleet
perform last month" — which is Shanitah's own question about their own
operation, and the reason an operations manager logs in at all.

**Give platform staff a "Shanitah" tenant to report against.** Rejected for
the third time, on the same grounds ADR-0005 and ADR-0006 rejected it: the
scope would mean two different things depending on who is asking, and there
is no Shanitah tenant whose trips these are — the trips are the clients'.

**Make the tenant filter required on all four reports.** Simpler and more
uniform than rule 3's split. Rejected because `reports/drivers` and
`reports/vehicles` aggregate a pool that is genuinely platform-owned, and
forcing a client selection there answers a worse question than the one
being asked.
