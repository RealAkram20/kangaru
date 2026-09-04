# ADR-0064: Three services on a booking, and whose booking the desk raises

**Status:** Accepted — 24 August 2026

**Depends on:** ADR-0012 (the walk-in order and its service triad), ADR-0024
§3 (self-drive never dispatches to a driver), ADR-0051 (vehicle category on a
booking), ADR-0055 (access levels; a fleet's staff are `isPlatformLevel()`),
ADR-0060 §4 (an active contract is what grants a fleet reach into a client).

**Supersedes in part:** the Bookings README's deferral of "self-drive and
corporate-booking variants" to Phase 2+.

## Context

The platform has offered ride, delivery and self-drive since ADR-0012 — to
**visitors**. The public order form collects all three, `OrderRequest` stores
them, and dispatch already knows which of them a driver is sent to. The
internal channel never caught up: a `Booking` was a passenger ride by
construction (no service column at all), so a corporate client could not book
a parcel or a rental on their account, and the owner asked for exactly that
on 24 August: *"both fleet admin and the corporate client [must] be able to
book ride, delivery and self drive."*

The same request surfaced a second, older gap the tests had already named:
`bookings.tenant_id` is NOT NULL and a fleet actor has no tenant, so **the
internal booking endpoint had never served the desk at all** —
`ColleagueBookingTest` records it in as many words. The owner's instruction
settles how to close it: *"the Fleet admin orders for the corporate client."*

## Decision

**1. `bookings.service_type`, from the walk-in's own enum.** The column
defaults to `ride` — true of every row that predates it — and is cast to
`OrderRequestServiceType`, deliberately shared rather than duplicated so the
two channels cannot grow different vocabularies. The enum keeps its name; a
rename would touch every dispatch call site for a cosmetic gain.

**2. Per-service extras in `bookings.details`, behind one allow-list.**
`Support/BookingDetails` is the only writer and only reader of the column,
holding the complete set of keys per service: a delivery's parcel, payment
and recipient; a self-drive's hire period and the identity documents the
renter will bring (named, never uploaded — the desk checks originals at
collection). The single writer narrows input to the submitting service's own
keys, so a payload built for a delivery and re-submitted as a ride cannot
leave a recipient's phone number sitting unrendered in a ride's row. What is
**not** in `details`: anything with a real column. The vehicle choice —
including a rental's — is `vehicle_category` (ADR-0051), validated against
the live vocabulary rather than the public form's hardcoded four.

**3. A self-drive booking has no route and no pickup time.** `origin` and
`destination` go nullable and are required precisely when the service is a
journey; `scheduled_for` is *prohibited* on a rental, because the walk-in
queue has already demonstrated the second-clock failure — hire dates in
`details`, `scheduled_for` null, "null means now", and a driver dispatched
to a car somebody else was going to drive.

**4. Self-drive cannot reach a driver, at both layers.** `?dispatchable=1`
excludes non-driver services (the board never shows a rental), and
`DispatchService::assign()` refuses one with `409 BOOKING_NOT_DISPATCHABLE`
(a dispatcher may post any booking id; a constraint that only exists in the
list somebody was shown is not a constraint). The booking lifecycle is
otherwise unchanged — the owner confirmed all three services share the same
optional approval flow — so an approved rental simply rests at Approved;
its fulfilment (handover, return) is a named gap, not an accident.

**5. The desk books by naming the client.** `tenant_id` on `POST /bookings`
is **required from a fleet actor** and validated against the clients the
fleet holds an *active* contract with (`OperatorClient::servedBy`, ADR-0060
§4 — asking grants nothing). An unserved id and a nonexistent id answer
byte-identically, for the enumeration reason `BookingIndexRequest` already
documents. From a client's own user the key is not a recognised input at
all — their one client is applied by `TenantContext`, and validating the
field for them would itself be the oracle. A named colleague must belong to
the named client, and the colleague search accepts the same `tenant_id`
narrowing so the dialog never offers another client's staff once the client
is chosen.

**6. Walk-ins stay in the walk-in queue.** The desk's booking channel now
requires a client on purpose. A caller who belongs to no client is
ADR-0012's customer, not a pseudo-tenant's.

## Consequences

- The delivery a corporate client books flows into ordinary dispatch — a
  Trip with a route — but the driver app reads parcel details off
  `order_requests` (`OrderDetails`), so a booking-created delivery reaches
  the driver as route-and-notes only. Surfacing `bookings.details` to the
  driver is follow-on work, in the trip payload, behind the same
  after-acceptance rule ADR-0024 §7 sets for contact details.
- Approval and rejection notifications describe the request through
  `Booking::requestDescription()` — one home for "what do we call this
  booking", because a rental has no route for the sentence to recite.
- `BookingResource.details` emits every key of the row's service with
  missing values as null, and null for a ride: consumers read one shape per
  service and can tell "not that kind of booking" from "nobody said".
- ~~The dialog's client list is `meta.filters.clients` (every client)~~ —
  closed the same day, on the owner's instruction that the desk books only
  for its assigned clients. `/bookings` now also serves
  `meta.bookable_clients` (`ClientOptions::bookableBy` — active contracts
  only), and the dialog reads that list, so it cannot offer an answer the
  server refuses. `filters.clients` stays wider on purpose: it narrows
  *existing* rows, which for a fleet can include an ended contract's
  history (ADR-0060 §7).
- Two same-day refinements from watching the form used: the contact number
  falls back to the named colleague's saved work number server-side
  (`StoreBookingRequest::prepareForValidation`; a typed number still wins),
  and the pickup time is prefilled with the current minute — with
  `pickupTimeForPayload()` sending "now-ish" as null, because a prefilled
  clock is stale by submit time and sending it verbatim earns the exact
  "must be in the future" refusal the prefill replaced. A far-past choice
  is still sent and refused loudly: that one is a typo, and silently
  re-reading last Tuesday as "now" dispatches a car nobody expects.
