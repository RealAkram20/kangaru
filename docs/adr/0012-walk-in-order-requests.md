# ADR-0012: Walk-In Order Requests

**Status:** Accepted (3 August 2026 — owner-approved scope change, moving
walk-in intake from PROJECT.md's deferred list into Phase 1)

**Depends on:** ADR-0005 (the fleet belongs to the platform; walk-in
customers are the platform's own customers, not a tenant's), ADR-0006
(platform staff and the two-halves isolation rule), ADR-0004 (permissions).

## Context

PROJECT.md has always named individual customers as part of the model and
deferred them. The design screens in `material/` (July 2026) define the
product they eventually get: Ride, Deliver, Self Drive, with wallets, live
fares, and PIN-confirmed delivery. None of that exists, and most of it has
unmet prerequisites — payments need their own ADR, live fares need ADR-0003's
positions, rider accounts need an authentication decision.

But the first commercial step needs none of those: a public page where a
visitor can *ask* for the service, and a queue where the platform's own
dispatchers see the ask and act on it by phone. Shanitah runs a phone-and-
dispatcher operation today; the page feeds that operation instead of
replacing it.

The question this ADR settles: **what is a walk-in order in a system where
every business row belongs to a tenant?**

## Decision

**A walk-in order request is platform data — it belongs to no tenant, is
written by an unauthenticated public endpoint, and is worked exclusively by
platform staff holding a dedicated permission. It is a request, not a
booking.**

### 1. The model

`order_requests`, in `Modules/Bookings` (it is a booking-shaped lead, and a
new module for one table would be ceremony). **No `BelongsToTenant`** — per
ADR-0005 the walk-in customer is the platform's customer, so the row follows
the same logic as vehicles and drivers. Fields: a public reference
(`KR-` + 6 chars, what the visitor quotes on the phone), `service_type`
(`ride` | `delivery` | `self_drive`), contact name/phone (+ optional email),
service-specific detail (pickup, drop-off, item type, dates, vehicle
preference) as structured columns where shared and JSON where per-service,
free-text notes, `status`, and the handling dispatcher's notes.

### 2. Status is a small honest machine

`new → contacted → converted | closed`, mutations audited
(`order_request.received`, `order_request.updated`). `converted` records
that the request became real-world work. **It does not create a Trip or a
Booking.** Both are tenant-owned today, and inventing a pseudo-tenant to
hold walk-in trips would quietly decide rider-account architecture inside a
CRM column. When walk-in fulfilment gets its ADR, `converted` gains a
foreign key; until then the queue is a lead tray, and this file says so.

### 3. The public endpoint

`POST /api/v1/public/order-requests`, unauthenticated. Validation by Form
Request with the same strictness as any tenant endpoint. Returns `201` with
the public reference. There is **no public read endpoint** — a status
checker keyed by guessable reference is an enumeration surface, deferred
until references carry enough entropy to be capability URLs.

Abuse posture, in order of cheapness: throttle **3/min/IP** (stricter than
auth's 5), a honeypot field that fake-succeeds without persisting (a bot
that believes it succeeded stops probing), hard length caps, and no SMS
anywhere in the flow (SMS pumping, AGENTS.md security section).

### 4. The dispatcher queue

`GET /api/v1/order-requests` and `PATCH /api/v1/order-requests/{id}`,
gated by a new permission `order_requests.manage`, seeded to Dispatcher and
Super Admin. Corporate roles never hold it. ADR-0006's second half applies
verbatim: a platform user without the permission sees nothing, and the
isolation suite must prove both halves. New requests notify holders of the
permission through the existing Notifications module.

### 5. The public pages

The existing React app grows public routes — no second site. `/` renders
the landing page for visitors and the dashboard for authenticated users, so
no existing URL changes meaning. `/order` is the request flow: service pick
mirroring the Ride / Deliver / Self Drive triad, per-service details,
contact, review, then the reference code. Visual language comes from
`material/` via the existing `--kr-*` tokens.

## Consequences

- Shanitah gets a public order channel this phase, worked by the team it
  already has, with an audit trail from the first request.
- The screens' full product (accounts, wallets, fares, PINs, live tracking)
  remains deferred, each behind its own ADR. This page forecloses none of it.
- A lead tray that cannot yet convert into a Trip is a deliberate half: the
  conversion FK lands with the walk-in-fulfilment ADR, not this one.
- One more unauthenticated write endpoint exists and must stay on the
  throttle + honeypot + no-SMS posture. The rate limit is per-IP and NAT'd
  offices share IPs; if a real partner hits the ceiling the number moves by
  config, not by removing the throttle.

## Alternatives Considered

**A pseudo-tenant that owns walk-ins.** Keeps `BelongsToTenant` uniform and
every scope happy. Rejected: it makes "no tenant" impersonate a tenant,
which ADR-0006 exists to avoid, and every tenant-facing surface (reports,
billing, exports) would need to special-case the fake row forever.

**Email-to-dispatch, store nothing.** Fastest to ship, zero schema.
Rejected: no audit trail, no queue, no statuses — invisible work in the one
company where auditability is the product.

**Full rider accounts now.** The screens' real product. Rejected as a first
step: payments, authentication for a second audience, and live pricing each
need decisions this pass has no business making implicitly.
