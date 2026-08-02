# ADR-0007: Reporting Scope for Platform Staff

**Status:** Proposed

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

The notification that follows ("your export is ready") is tenant-scoped
for the same reason, which is why a platform user's inbox is empty today.
Reports, exports and notifications are one problem, not three.

## Decision

**Not taken.** This ADR is Proposed and needs the owner's call, because
option 2 below is a product judgement about what a number *means* rather
than an engineering trade-off.

### Recommended: an explicit, required tenant selection for money; spanning for the fleet

1. **`reports/trips` and `reports/financial` gain an optional
   `tenant_id` filter, honoured only for platform staff.** A client's user
   supplying it is ignored — they have exactly one tenant and it is not a
   parameter they get to choose.

2. **For `reports/financial`, `tenant_id` is _required_ when the actor is
   platform staff.** This is the recommendation's sharp edge and the part
   that wants agreement. An omitted filter returns `422`, not a
   cross-client total. Refusing to answer is better than answering with a
   figure whose meaning nobody agreed: "all clients' revenue this month" is
   a real question, but it is a **platform P&L**, not the client-facing
   financial report this endpoint is, and it deserves its own endpoint
   rather than the same one behaving differently depending on who asked.

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
tenant is ignored rather than obeyed. That second one is the new escalation
surface this ADR creates and the test that must exist before it ships.

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
