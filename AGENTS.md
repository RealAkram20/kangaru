# AGENTS.md

# KangaruRide Development Standards

## Overview

KangaruRide is an enterprise-grade Transport Management Platform designed for corporate fleet management, dispatch, route tracking, GPS monitoring, billing, reporting, and future marketplace ride services.

This project prioritizes maintainability, scalability, reliability, and an exceptional user experience.

Every implementation must follow these standards. A standard that is not enforced by tooling is a suggestion — the CI gates in this document are what make these rules real.

---

# Core Principles

## User First

Every feature should answer:

- Does this make the user's work easier?
- Can a first-time user understand it?
- Does it reduce clicks?
- Does it reduce mistakes?

The system should guide users instead of expecting them to remember complex workflows.

## Enterprise Quality

Develop as if the platform will eventually serve banks, government institutions, NGOs, large fleet operators, and public transport providers. Our first anchor client is a bank — auditability and correctness are features, not chores.

Avoid shortcuts that create technical debt.

## Modular Architecture

Every major feature exists as an independent module with minimal coupling:

```
Modules/
    Fleet/
    Drivers/
    Vehicles/
    Bookings/
    Trips/
    Dispatch/
    Billing/
    Reports/
    Clients/
    Notifications/
    Administration/
```

Organize by feature, not file type:

```
Modules/Fleet/
    Controllers/
    Services/
    Repositories/
    Models/
    Requests/
    Policies/
    Resources/
```

Avoid large files that mix unrelated responsibilities. Never create "God Classes".

---

# Architecture Decision Records (ADRs)

Every significant architectural decision is recorded as an ADR in `docs/adr/`, formatted `NNNN-short-title.md` with Context, Decision, Consequences, and Alternatives Considered.

A decision without an ADR can be reversed by anyone. A decision with an ADR requires a superseding ADR.

The following three ADRs are adopted now.

## ADR-0001: Multi-Tenancy Model

**Status:** Accepted

**Decision:** Single database, shared schema, mandatory tenant scoping.

- Every tenant-owned table carries a non-nullable, indexed, foreign-keyed `tenant_id`.
- A global Eloquent scope (`BelongsToTenant` trait) applies tenant filtering automatically. Opting out is rare and reviewed.
- Raw queries that bypass the scope are forbidden outside repositories and must include `tenant_id` manually with a comment explaining why.
- Cache keys are prefixed `tenant:{id}:`. File storage paths are prefixed `tenants/{id}/`.

**Consequences:** Simple operations and one migration path, right for our scale. A cross-tenant data leak is the single worst bug this platform can have — mitigated by a mandatory CI test suite that attempts cross-tenant reads on every API resource and must fail. If a future client demands physical isolation, tenant-scoped queries make extraction to a dedicated database possible; document as escape hatch, do not build now.

**Alternatives considered:** Database-per-tenant (operational burden too high); schema-per-tenant (poor MySQL fit).

## ADR-0002: Repository Pattern Scope

**Status:** Accepted

**Decision:** Repositories are required only where they earn their cost:

1. Queries used by two or more services.
2. Non-trivial queries (joins, aggregates, geospatial, reporting).
3. Anything touching billing, invoicing, or payments (isolation aids auditing and testing).

Simple single-model CRUD inside a service may use Eloquent directly. A repository that only proxies `find`/`create`/`update`/`delete` with no added logic must be deleted in review.

## ADR-0003: GPS Ingestion Path

**Status:** Accepted

**Decision:**
- GPS pings enter via API → validated → pushed to a Redis stream → batch-inserted by a queue worker into a dedicated `trip_locations` table partitioned by month.
- Live tracking reads latest positions from Redis, never MySQL.
- MySQL holds historical routes for replay and billing distance verification.
- Retention: raw pings 12 months, then downsampled polylines only.

---

# Development Standards

## Single Responsibility Principle

Each class, service, controller, repository, policy, and component has one clear responsibility.

## Service Layer

Business logic never lives inside controllers. Controllers only validate requests, call services, and return responses. Target 20–60 lines per controller method.

## Reusable Components

Never duplicate UI. If a component appears more than once, convert it into a reusable component.

## Configuration Driven

Avoid hardcoded values.

❌ Vehicle rate = 3800
✔ Read from Rate Cards

Tax, waiting charges, zone radius, night charges, and client contracts must all come from the database or configuration.

---

# Money & Billing Standards

The platform's credibility lives or dies on billing correctness. These rules are absolute.

## Representation

- All monetary amounts are stored as **integers in the currency's minor unit**. UGX is a zero-decimal currency: store whole shillings as integers. If multi-currency arrives: `amount` (int) + `currency` (ISO 4217). Never floats. Never raw DECIMAL arithmetic in PHP.
- Use a money value object (e.g., `brick/money`) in all services. Raw integer math on money outside the value object fails review.

## Calculation

- Rounding rules are defined **per rate card** (default: round half-up to nearest shilling). The rounding rule used is stored on the invoice line.
- Every invoice line stores its inputs: rate card version, zone, distance, waiting minutes, multipliers applied. An invoice must be **fully reproducible** from stored data.
- Rate cards are versioned and immutable once used. Editing creates a new version; historical invoices keep their version reference. This is what ends billing disputes.

## Integrity

- Invoice generation and payment recording are **idempotent**: every mutation carries an idempotency key; replays return the original result, never a duplicate.
- Invoice numbers are sequential per tenant, generated inside a transaction with a locked counter row. Gaps and duplicates are both audit findings for bank clients.
- Financial mutations are append-only where possible: corrections are credit notes or adjustments, never silent edits to issued invoices.

## Concurrency (Dispatch)

- Assigning a driver or vehicle uses **pessimistic locking** (`SELECT ... FOR UPDATE` on the vehicle and driver rows) inside a transaction. Two dispatchers must never both succeed in assigning the same vehicle to overlapping trips. A CI test races two assignments and asserts exactly one wins.

---

# Trip State Machine

The trip lifecycle is an enforced state machine, not a convention.

- Allowed transitions are defined in one place (enum + transition map). Services request transitions; the state machine validates, applies side effects (timestamps, notifications, events), and rejects anything else with `409 INVALID_TRIP_TRANSITION`.
- Required states beyond the happy path:
  - **Cancelled** — reachable from any pre-`Trip Started` state; records who, why, and whether a cancellation charge applies (rate-card driven).
  - **No Show** — from `Driver Arrived` after a configurable wait; billing per rate card.
  - **Rejected / Reassignment** — driver declines from `Assigned`; trip returns to the dispatch pool with the rejection recorded against the driver.
  - **Disputed** — from `Invoice Generated`; blocks `Closed` until resolved via credit note or confirmation.
- Every transition is timestamped in an append-only `trip_events` table (the timeline). Waiting-time billing is computed from `trip_events`, never from a mutable column.

## Odometer Capture

Corporate clients (Centenary Bank requirement) need physically verifiable mileage:

- **Opening odometer reading** is captured at `Trip Started`; **closing reading** at `Trip Completed`. Driver-entered value plus a dashboard photo.
- A reading is refused outright if it is below the opening one, or if it makes the journey longer than the configured ceiling (ADR-0035). Refused at the transition, so an impossible reading never becomes a fare — the flag below cannot do this job, because it needs a GPS trace and is a review signal rather than a refusal.
- Odometer distance is automatically reconciled against GPS-calculated distance; variances beyond a configurable threshold are flagged for review. Both the threshold and the ceiling are operator settings, not env vars — an office must be able to change them without a deploy, and the change must be audited.
- Odometer values are stored on the trip record and included in trip reports and invoices.

---

# Database Standards

- Proper foreign keys; never store duplicated information.
- UUIDs where external references are exposed.
- Timestamps everywhere; soft deletes where appropriate.
- Indexes for searchable fields; database constraints for invariants.
- Every migration must be reversible in CI (`up` then `down` runs against MySQL 8). Exception: destructive data migrations may be irreversible — they require a verified pre-migration backup step in the deploy runbook and a note in the PR, instead of a fake `down()`.
- Zero-downtime rule for production: additive first (add nullable column → backfill via job → enforce constraint → remove old column in a later release). Never rename a column in one step.
- `trip_locations` is partitioned by month from day one; partitions older than 12 months are archived to R2 as compressed exports.

---

# API Standards

## Versioning

- All routes live under `/api/v1/...` from day one. Breaking changes require `/api/v2`; v1 is maintained for a published deprecation window (minimum 6 months once the driver app ships).
- Additive changes (new optional fields) are allowed within a version. Removing or renaming fields is not.

## RESTful naming

```
GET     /api/v1/bookings
POST    /api/v1/bookings
PATCH   /api/v1/bookings/{id}
DELETE  /api/v1/bookings/{id}
```

## Status codes and envelope

- 200 read/update, 201 create, 204 delete
- 401 unauthenticated, 403 unauthorized, 404 not found — 404 also masks cross-tenant IDs; never return 403 for another tenant's resource
- 422 validation, 409 conflict (e.g., vehicle already assigned), 429 rate limited, 5xx server

Success:

```json
{ "success": true, "message": "...", "data": {} }
```

Failure — always includes a stable machine-readable `code`:

```json
{
  "success": false,
  "code": "VEHICLE_UNAVAILABLE",
  "message": "This booking could not be completed because the selected vehicle is no longer available. Please choose another vehicle or contact your dispatcher.",
  "errors": {}
}
```

Codes are enumerated in a single `ErrorCode` enum and documented. Clients branch on `code`, never on message text.

## Pagination, filtering, expansion

- Cursor pagination for large or append-heavy lists (trips, GPS); page pagination acceptable for admin CRUD. Standard meta block: `meta.cursor.next` or `meta.page / per_page / total`.
- Filtering via whitelisted query params per endpoint; unknown filters return 422, not silence.
- Relationship expansion via `?include=driver,vehicle` (whitelisted), backed by eager loading.

## Contract

The API is documented with OpenAPI, verified in CI. Mobile apps are built against this contract; drift between code and spec fails the build.

---

# Validation

Validate everything. Never trust client input. Use Form Requests. Return friendly validation messages.

---

# Error Handling

Never expose raw exceptions to users. Every error message explains what happened, why (when appropriate), and what the user should do next.

❌ `SQLSTATE...`
✔ "This booking could not be completed because the selected vehicle is no longer available. Please choose another vehicle or contact your dispatcher."

---

# Enforcement & Tooling (CI Gates)

All of the following run in CI; any failure blocks merge.

## Backend

- **Laravel Pint** — code style, zero tolerance.
- **PHPStan (Larastan) level 8** on new code; legacy baseline allowed but must shrink monthly.
- **Pest** — suite must pass. Coverage gates: **90% on `Modules/Billing` and `Modules/Dispatch`**, 70% overall.
- Migration reversibility check against MySQL 8.
- Cross-tenant isolation test suite (ADR-0001) — mandatory, non-skippable.
  Since ADR-0006 it has two halves, and both are mandatory: that a **client**
  sees only their own, and the mirror — that a **platform** user with no
  permission on a surface sees nothing of it either. Platform staff belong
  to no tenant and so read across all of them; without the second half,
  having no tenant quietly becomes a permission of its own.
- Dispatch race-condition test — mandatory.

## Frontend

- **ESLint + Prettier** with committed config; `tsc --noEmit` must pass. No `any` without an inline justification comment.
- Component tests (Vitest + Testing Library) for shared components and critical flows (booking form, dispatch board).

## Process

- Protected `main`. Merges only via PR with at least one approval; `Modules/Billing` and `Modules/Dispatch` require a CODEOWNERS-designated reviewer.
- Conventional Commits enforced by commitlint:
  - `feat: add corporate booking approval workflow`
  - `fix: correct waiting charge calculation`
  - `refactor: extract billing service`
- Secrets scanning (gitleaks) on every push. A committed secret is rotated the same day.
- `composer audit` and `npm audit` weekly; critical CVEs patched within 7 days.

---

# Observability

## Logging

- Structured JSON logs in production. Every log line carries `request_id`, `tenant_id`, `user_id`, `module`.
- A `request_id` (UUID) is generated at the edge, returned in the `X-Request-Id` response header, and propagated through queue jobs.
- Business events are logged as structured events with stable names: `booking.created`, `driver.assigned`, `invoice.generated`, `payment.received`, `vehicle.reassigned`. Avoid free-text and excessive logging.

## Metrics & Alerts

Minimum dashboard from day one: API p95 latency, 5xx error rate, queue depth and oldest job age, GPS ingestion lag, failed jobs, dispatch decision time, DB connections.

Minimum alerts (paged, not emailed into a void): 5xx rate > 2% for 5 min; oldest queued job > 5 min; GPS ingestion lag > 60 s; any failed invoice generation; disk > 80%; certificate expiry < 14 days.

## Audit Log (product feature)

Every mutation to rate cards, contracts, invoices, payments, roles/permissions, and credit limits is written to an append-only `audit_logs` table: who, what, before/after diff, when, from which IP. Tenant admins can query their own tenant's audit log. This must exist before the first bank demo.

---

# Security

## Authorization

- Every endpoint has a Policy; a route without a policy check fails review. Use Policies, Gates, and Role Permissions. Never rely solely on frontend permissions.
- Cross-tenant resource access returns 404, never 403.

## Technical requirements

- TLS everywhere; HSTS on.
- Passwords via Laravel defaults (bcrypt/argon2). **MFA defaults to required for Super Admin and Finance** — these roles can move money and change rates. Since ADR-0061 it is a **setting, not a constant**: a platform switch (`auth.mfa_enforced`) and a per-role one (`roles.requires_mfa`), resolved in exactly one place, `User::requiresMfa()`. Never read either column directly to decide whether somebody needs a second factor — two callers combining two gates themselves is how they drift apart.
- Encryption at rest: MySQL tablespace encryption, R2 default encryption; driver documents (IDs, licenses) additionally app-level encrypted.
- Secrets via environment from a managed store — never in the repo.
- Sanitize inputs, escape outputs. Prevent SQL injection, XSS, CSRF.
- Rate limiting: auth endpoints 5/min/IP; OTP/SMS endpoints aggressively limited (SMS pumping fraud is a real cost in East Africa).
- Sanctum tokens with expiry; token abilities scoped per client app when the driver app ships.

## Compliance

- The Uganda **Data Protection and Privacy Act, 2019** applies. Maintain a data inventory (what PII, where, why, retention), a written retention policy (trip PII 7 years for financial records, raw GPS 12 months, ex-employee accounts anonymized 90 days after deactivation), and a documented breach-response procedure. Verify Personal Data Protection Office registration requirements before launch.
- Maintain a living vendor-security-questionnaire answers document for bank clients.

---

# Performance

- Prevent N+1 queries; eager load relationships.
- Paginate large datasets. Cache frequently used data with tenant-prefixed keys.
- Move long-running tasks into queues; anything over 3 seconds must not block a request.
- Loading indicators for long-running actions — never leave users wondering if the system is working.

---

# Frontend Standards

Design for enterprise users. Interfaces must be clean, spacious, accessible, responsive, and keyboard friendly. Consistency is more important than decoration.

**Building a screen? Read `docs/screen-rules.md` first.** It is the checklist over this document and DESIGN.md, and it exists because two mistakes keep arriving disguised as faithful work: putting a number on screen the platform cannot produce, and showing data an ADR deliberately withholds. Those rules outrank any mockup — where the two disagree, raise it rather than resolving it silently.

## Accessibility

Keyboard navigation, visible focus states, proper labels, color contrast, screen reader compatibility.

## Offline resilience

Trip capture flows (status updates, odometer readings) must tolerate patchy connectivity: capture locally, sync when connected, and show sync state clearly. Drivers operate upcountry where network is unreliable.

---

# Code Style & Naming

Write self-explanatory code. Comment only to explain business rules or non-obvious decisions.

Good names: `CorporateClientService`, `TripBillingEngine`, `VehicleAvailabilityService`.
Bad names: `Helper`, `Utils`, `Manager`, `CommonService`, `DataProcessor2`.

---

# Notifications

Use notifications only when meaningful: Booking Assigned, Trip Started, Trip Completed, Invoice Ready, Vehicle Maintenance Due, Document Expiring. Avoid notification fatigue.

---

# Delivery & Environments

- Environments: `local` → `staging` → `production`. Staging mirrors production topology (Nginx, PHP-FPM, Redis, Supervisor, real queue workers) and uses **anonymized** seed data — never a production dump with real PII.
- Trunk-based development: short-lived feature branches → PR → `main`. `main` is always deployable.
- Deploys are tagged, logged, and reversible. The rollback procedure is written down and rehearsed before first client onboarding.
- Feature flags for anything client-visible and risky; dispatch algorithm changes always ship behind a flag.

## Definition of Done

A feature is done when: code and tests merged, authorization/policy covered, the API contract updated (`docs/api/openapi.yaml` — a new or changed endpoint's spec entry ships in the same PR; the route census and response validation in CI enforce this, see ADR-0011), audit events emitted where applicable, feature flag state decided, and the module README updated. Not before.

---

# Documentation

Every module includes a README covering Purpose, Responsibilities, Dependencies, and Public APIs. Kept current via the Definition of Done.

---

# Development Mindset

When implementing a feature, always ask:

- Is this reusable? Can another module use it?
- Is it configurable? Will it scale?
- Will another developer understand it six months from now?

Optimize for maintainability over speed. Build software that is easy to extend, not just easy to finish.
