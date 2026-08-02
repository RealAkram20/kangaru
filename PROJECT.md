# KangaruRide

> Enterprise Transport Management & Fleet Operations Platform

Version: 1.1
Status: Planning → Phase 1 Build
Owner: Shanitah General Enterprises Ltd

---

# Project Overview

KangaruRide is an enterprise-grade Transport Management Platform developed to modernize fleet operations, dispatch, trip management, GPS tracking, billing, reporting, and corporate transport services.

The platform was initially designed to solve transport management challenges for corporate clients such as Centenary Bank but is architected as a scalable multi-tenant solution capable of serving:

- Corporate Organizations
- Government Institutions
- NGOs
- Fleet Owners
- Logistics Companies
- Transport Providers
- Individual Customers (Future)

The goal is to replace manual paperwork, improve operational efficiency, automate billing, provide complete trip visibility, and deliver accurate reporting.

## Anchor Client Requirement (Centenary Bank, Ref CRDB/CS/F/26, 22 July 2026)

The Bank requires that all vehicles supplied operate an automated system capturing and reporting, at minimum, for each trip:

1. Date and time of trip commencement and completion
2. Vehicle registration details
3. Trip origin and destination
4. Opening and closing odometer (mileage) readings
5. Total distance travelled
6. Trip duration in hours/minutes

These six items are the **formal acceptance criteria for the Phase 1 MVP** and the basis of the demonstration sessions the Bank has offered. Everything in Phase 1 must serve delivering these flawlessly; everything else is secondary.

---

# Vision

Build Africa's leading enterprise transport management ecosystem that seamlessly connects organizations, fleet owners, drivers, and passengers through intelligent automation.

# Mission

To simplify transport operations through technology by providing reliable booking, dispatching, fleet management, route tracking, automated billing, and enterprise reporting.

---

# Core Objectives

- Eliminate manual trip logs
- Automate transport operations
- Track every trip digitally
- Reduce billing disputes
- Improve fleet utilization
- Improve driver accountability
- Generate enterprise reports
- Support future ride-hailing services

---

# Scope

## Phase 1 MVP — explicitly IN scope

- Corporate client onboarding (multi-tenant)
- Employee bookings: immediate and scheduled
- Manual and hybrid dispatch
- Full trip lifecycle with GPS tracking
- **Odometer capture**: driver-entered opening/closing readings with dashboard photo at Trip Started / Trip Completed, auto-reconciled against GPS distance with variance flagging
- Rate-card billing with monthly invoicing
- Core reports: trip, driver, vehicle, financial — exportable to PDF, Excel, CSV
- Roles, permissions, and tenant-visible audit log
- Offline-tolerant trip capture (sync-when-connected) for upcountry operation

## Phase 1 — explicitly OUT of scope (deferred, not forgotten)

- Driver mobile app (drivers use a mobile-responsive web flow in Phase 1)
- Marketplace features
- WhatsApp and push notifications
- Multi-currency
- Self-drive workflows
- MFA for non-privileged roles (required for Super Admin and Finance only)

Anything moving from OUT to IN requires an owner-approved scope change, not a hallway agreement.

---

# Target Customers

**Phase 1:** Corporate companies, banks, NGOs, government agencies, fleet owners.
**Phase 2:** Driver partners, corporate employees.
**Phase 3:** Individual customers, marketplace transport providers.

---

# Non-Functional Requirements

Design targets for Phase 1. Adjust with production data; never delete.

## Scale

- 50 concurrent corporate clients (tenants)
- 2,000 vehicles, 3,000 drivers
- 10,000 trips/day
- GPS: 1 ping / 10 seconds per active vehicle → peak ~200 writes/second
- 200 concurrent dashboard users

## Latency

- API p95 < 400 ms, p99 < 1 s (excluding report generation)
- Dispatch assignment decision < 5 s from booking confirmation
- Live map position freshness < 15 s
- Reports generate asynchronously via queue; nothing over 3 s blocks a request

## Availability & Recovery

- Uptime target 99.5% monthly (excluding announced maintenance)
- RPO 15 minutes: binlog-based backups plus nightly full dumps, restores tested monthly
- RTO 4 hours, with a written, rehearsed disaster runbook
- Graceful degradation: if Mapbox is down, bookings and dispatch continue with manual distance entry flagged for later verification. No third-party outage halts core operations.

## Data Growth

`trip_locations` is the growth risk (~500M rows/year at target scale). Partitioned by month from day one; partitions older than 12 months archived to Cloudflare R2 as compressed exports.

---

# Product Modules

## Identity & Access Management

Authentication, authorization, roles, permissions. MFA required for Super Admin and Finance in Phase 1; other roles later.

## Company Management

Corporate clients, departments, employees, branches, cost centers, credit limits.

## Fleet Management

Fleet owners, branches, depots, vehicles, vehicle categories, vehicle status, maintenance, vehicle documents.

**The fleet belongs to the platform** (ADR-0005). Shanitah operates and
manages every vehicle and driver; a corporate client owns none of either —
they are a client, not an operator. A vehicle may be *allocated* to a client
for a period, which is what Centenary Bank's letter means by "vehicles
supplied to the Bank", but that is a contract, not ownership.

## Driver Management

Driver profiles, qualifications, availability, assignments, performance, documents.

## Booking Management

Immediate booking, scheduled booking, multi-stop trips, return trips, chauffeur service, self drive (Phase 2+), corporate booking.

## Dispatch Engine

**Automatic and manual dispatch, both in Phase 1.** Moved from the
out-of-scope list above by owner approval on 2 August 2026 — the platform is
a hailing operator (Faras, Uber, Bolt, SafeBoda), and hailing cannot be
manual.

Dispatch considers: preferred driver, preferred vehicle, driver
availability, vehicle availability, distance, geofence, vehicle category,
branch, depot. Assignment uses pessimistic locking — no double-assignment,
ever.

The two halves have different prerequisites, and the second is not yet met:

- **Availability, vehicle category and passenger count** need only a shared
  fleet, which ADR-0005 delivers.
- **Distance** needs live driver positions. ADR-0003's Redis stream and
  live-position reads are unbuilt, and an automatic dispatcher that cannot
  tell which driver is nearest is a queue, not a matcher.

## Trip Management

Each trip records: pickup, destinations, GPS route, driver, vehicle, distance, duration, waiting time, stops, timeline, status, and **opening/closing odometer readings with dashboard photos**. Odometer distance is reconciled against GPS distance automatically; variances beyond a configurable threshold are flagged.

## GPS & Maps

Powered by Mapbox: route preview, route history, GPS tracking, geofencing, distance calculation, reverse geocoding. Geocoding results are cached; per-tenant API spend is monitored.

## Geofencing Engine

Town zones, upcountry zones, client-specific zones, branch boundaries, depot boundaries, service areas. Automatically determines pricing zone, driver eligibility, and vehicle eligibility.

## Billing Engine

Dynamic and fully configurable: distance charges, waiting charges, zone pricing, vehicle pricing, contract pricing, additional charges, discounts, taxes. No billing rules hardcoded. Amounts stored as integer UGX; every invoice reproducible from stored inputs; invoice generation idempotent.

## Rate Cards

Independent pricing per corporate client: vehicle type, zone, distance, waiting charges, night rates, weekend rates, holiday rates, minimum and maximum charge. Rate cards are **versioned and immutable once used** — historical invoices always reference their exact version.

## Finance

Invoices, payments, credit limits, statements, monthly billing, outstanding balances. Corrections via credit notes, never edits to issued invoices.

## Reports

Daily, weekly, monthly, and annual reports; trip, driver, vehicle, and financial reports. Export to PDF, Excel, CSV. The Bank's six required data points appear on every trip report.

## Notification Center

Email, SMS, system notifications. Future: WhatsApp, push.

## Audit Log

Append-only record of every change to rate cards, contracts, invoices, payments, roles, and credit limits — who, what, before/after, when, from where. Queryable by tenant admins. Demonstrated in every bank presentation.

---

# User Roles

- **Super Admin** — platform owner (MFA required)
- **Operations Manager** — manages operations across the platform
- **Dispatcher** — assigns drivers and vehicles
- **Finance** — manages invoices and payments (MFA required)
- **Fleet Owner** — manages owned fleets
- **Branch Manager** — manages branch operations
- **Depot Manager** — manages vehicles and drivers within a depot
- **Corporate Admin** — manages company users and bookings
- **Corporate Employee** — requests transport
- **Driver** — mobile-responsive web flow in Phase 1; dedicated app in Phase 2

---

# Trip Lifecycle

```
Booking Created
    ↓
Approved (optional)
    ↓
Assigned ──────────────→ Rejected → back to dispatch pool
    ↓                              (recorded against driver)
Accepted
    ↓
Driver En Route
    ↓
Driver Arrived ────────→ No Show (after configurable wait;
    ↓                     billed per rate card)
Passenger Onboard
    ↓
Trip Started  ← opening odometer + photo captured
    ↓
Waiting ⇄ Trip Resumed
    ↓
Trip Completed  ← closing odometer + photo captured
    ↓
Invoice Generated ─────→ Disputed (blocks Closed until
    ↓                     resolved via credit note)
Closed

Cancelled: reachable from any state before Trip Started;
records who, why, and rate-card-driven cancellation charge.
```

The lifecycle is enforced as a server-side state machine. Illegal transitions are rejected, every transition is timestamped in an append-only `trip_events` table, and waiting-time billing is computed from those events.

---

# Technology Stack

**Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
**Backend:** Laravel 12, PHP 8.4
**Database:** MySQL 8 (single database, shared schema, tenant-scoped — see ADR-0001)
**Cache/Streams:** Redis
**Maps:** Mapbox
**Realtime:** Laravel Reverb
**Storage:** Local (dev), Cloudflare R2 (production)
**Authentication:** Laravel Sanctum
**Deployment:** Ubuntu Server, Nginx, PHP-FPM, Supervisor, Redis

# Architecture

```
React Web Application
        ↓
   REST API (/api/v1)
        ↓
  Laravel Backend
        ↓
 Business Services
        ↓
   Repositories (where they earn their cost — ADR-0002)
        ↓
MySQL ← Redis (cache, queues, GPS stream — ADR-0003)
        ↓
      Mapbox
```

---

# Guiding Principles

User First · Enterprise Ready · Modular · Configurable · Secure · Scalable · Maintainable · API First · Performance Focused · Auditable

---

# Roadmap

## Phase 1 — Enterprise Web Platform (current)

Corporate clients, fleet management, manual/hybrid dispatch, trip lifecycle with odometer + GPS, rate-card billing, reports, administration, audit log. Delivered against the Bank's six acceptance criteria and demonstrated in their offered sessions.

## Phase 2 — Driver Mobile Application

Accept trips, GPS, navigation, status updates, native offline capture.

## Phase 3 — Corporate Employee Mobile App

Book trips, track driver, notifications.

## Phase 4 — Marketplace

Taxi, boda boda, self drive, van hire, truck hire.

---

# Success Metrics (first client, first 6 months)

Measure the manual baseline before go-live so improvement is provable.

- 100% of trips digitally recorded — zero paper logs
- All six Bank-required data points present on 100% of completed trips
- Billing disputes < 2% of invoices (vs. measured manual baseline)
- Invoice generation ≤ 1 business day after month close
- Dispatch time from request to assignment: p90 < 10 minutes
- ≥ 95% of trips with complete GPS routes
- Odometer/GPS distance variance flags reviewed within 2 business days

---

# Risks & Mitigations

1. **Cross-tenant data leak** — highest severity for bank clients. Mitigation: mandatory tenant scoping (ADR-0001), non-skippable CI isolation tests, penetration test before bank onboarding.
2. **Billing correctness dispute with the anchor client.** Mitigation: reproducible invoices, versioned immutable rate cards, and a parallel run against manual billing for the first month.
3. **GPS data volume degrading the database.** Mitigation: Redis-stream ingestion, monthly partitioning, 12-month retention (ADR-0003).
4. **Connectivity gaps upcountry breaking trip capture.** Mitigation: offline-tolerant capture with sync-when-connected; odometer photos queue locally.
5. **Mapbox cost or outage dependency.** Mitigation: degradation mode with manual distance entry, geocoding cache, per-tenant spend monitoring.
6. **Single-developer bus factor.** Mitigation: ADRs, module READMEs enforced via Definition of Done, written runbooks.

---

# Long-Term Vision

KangaruRide is not just a booking platform. It is an enterprise mobility ecosystem that unifies fleet management, transport operations, dispatching, GPS tracking, billing, analytics, and corporate mobility into a single intelligent platform capable of serving organizations across Africa.
