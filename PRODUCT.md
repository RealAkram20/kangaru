# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The primary surface is the web app (`frontend/`: React + Tailwind + shadcn/ui).
A companion driver app (`mobile/`: React Native / Expo) shares the same brand
language rather than adapting per OS. It is **Android-first**: fleet handsets
are Android and Android is the design and review target; iOS must run
correctly but is not the primary target.

## Users

- **Dispatchers and fleet coordinators** — assign vehicles and drivers, watch
  live trips, resolve conflicts. Work at a desk, all day, in the web app.
- **Finance and billing staff** — generate, verify, and defend invoices.
  Read dense tables for hours; auditability is their daily job. Web app.
- **Corporate client admins** (e.g. bank transport officers) — request and
  approve bookings, review trip reports and invoices for their own tenant.
- **Drivers** — receive assignments, run trips, capture odometer readings and
  status updates on Android handsets, often upcountry on patchy networks.
- **Platform administrators** — tenants, rate cards, roles, system settings.

## Product Purpose

KangaruRide is an enterprise transport management platform: corporate fleet
management, dispatch, GPS trip tracking, billing, reporting, and a planned
marketplace phase. Success means a fleet operator can run dispatch and prove
every invoice, and a bank client can audit any trip end to end.

## Positioning

**Audit-grade correctness.** Every invoice is fully reproducible from stored
data (versioned immutable rate cards, stored calculation inputs, append-only
corrections); odometer readings are reconciled against GPS distance; the trip
lifecycle is an enforced state machine with an append-only event timeline.
Built to survive a bank's auditors, not just to schedule cars.

## Operating Context

- Multi-tenant SaaS: single database, mandatory tenant scoping (ADR-0001).
  A cross-tenant leak is the worst possible bug.
- First anchor client is a bank (Centenary Bank requirements appear in the
  odometer and audit rules).
- Drivers operate upcountry in Uganda where connectivity is unreliable; trip
  capture flows must work offline and sync later.
- Finance staff read dense light-surface tables for hours; dispatchers watch
  live boards.

## Capabilities and Constraints

- Backend: Laravel modular monolith (`backend/Modules/*`), MySQL 8, Redis
  streams for GPS ingestion, queue workers. API versioned under `/api/v1`,
  OpenAPI contract enforced in CI.
- Money is integer minor units (UGX is zero-decimal), value objects only,
  never floats. Rounding rules live on versioned rate cards.
- Enforced trip state machine; transitions logged to append-only
  `trip_events`.
- **Market scope: Uganda first, built international-ready.** Launch is
  UGX/Uganda, but new work must not deepen the Uganda assumption: screens and
  services are i18n-safe (no concatenated or hardcoded user-facing strings),
  money is currency-shaped (`amount` + ISO 4217, minor units), dates and
  times are timezone-aware, and formats (phone, plate, address) are not
  hardwired to Ugandan conventions. Multi-country launch targets are
  deliberately undecided.
- **Cost discipline: subscription-expense efficient.** Prefer open-source and
  self-hosted over recurring paid services; a new subscription dependency is
  a user decision, not an implementation detail.
- MFA required for Super Admin and Finance roles; policies on every endpoint;
  cross-tenant access answers 404.

## Brand Commitments

- Name: **KangaruRide**. Palette, typography (Sora / Inter / JetBrains Mono),
  and component rules are binding in `DESIGN.md`.
- Icons: **Lucide only**, both apps (DESIGN.md §7). No other icon set; no
  emoji as interface iconography.
- Dark chrome, light content: navy sidebar/topbar, dense data always on light
  surfaces.
- Fonts self-hosted; no Google Fonts hotlinking (offline caching, upcountry
  speed).

## Evidence on Hand

- `AGENTS.md` — engineering standards, CI gates, Definition of Done.
- `DESIGN.md` — binding design system. `docs/screen-rules.md` — screen
  checklist. `docs/adr/` — decision records (ADR-0001 tenancy, ADR-0002
  repositories, ADR-0003 GPS, and later).
- `docs/api/openapi.yaml` — the API contract, CI-verified.
- No public marketing site copy, testimonials, or case studies exist yet —
  future work must not fabricate them.

## Product Principles

1. **User first** — fewer clicks, fewer mistakes; the system guides instead
   of expecting memorized workflows. Modern and friendly beats feature-dense.
2. **Auditability is a feature** — reproducible invoices, append-only
   records, audit logs; correctness before convenience.
3. **Honest screens** — never display a number the platform cannot produce or
   data an ADR withholds; rules outrank mockups.
4. **Efficient to run** — efficient in use (dispatcher seconds matter) and in
   operating cost (self-hosted over subscriptions).
5. **International-ready from Uganda** — every new piece works when the
   second country arrives: i18n-safe, currency-shaped, timezone-aware.

## Accessibility & Inclusion

WCAG AA is enforced (contrast-checked pairings, keyboard navigation, visible
focus, labels, never color alone for status — AGENTS.md + DESIGN.md §8).
Driver app must stay legible in direct sunlight and usable on patchy networks.
