# Bookings

## Purpose

The request for transport, before any vehicle or driver exists on it —
what a Corporate Employee raises and a Dispatcher works from. Covers
PROJECT.md's Booking Management scope for Phase 1: immediate and scheduled
bookings, with an optional approval step.

A Booking becomes a Trip only through `Modules/Dispatch`; this module never
touches vehicles or drivers.

## Responsibilities

- `Booking` — the request record. `status` is only ever written by
  `BookingService` (the approve/reject/cancel decisions) and by
  `Modules\Dispatch\Services\DispatchService` (the move to `Assigned`) —
  never by a raw update, for the same reason `Trip::status` is gated.
- `BookingStatus` (`Modules/Bookings/Enums/BookingStatus.php`) — the
  lifecycle graph with an `allowedTransitions()` map, mirroring
  `TripStatus`. It stops exactly where `TripStatus` begins; the two are
  deliberately separate graphs, because the booking's question ("will we
  serve this?") and the trip's ("where is the vehicle now?") have different
  actors and different terminal states.
- `BookingService` — creation and the approve/reject/cancel decisions. Each
  decision re-reads the booking under `lockForUpdate` before checking the
  transition, so two admins deciding at once cannot both write and have the
  loser silently overwrite the winner's recorded reason.
- Immediate vs scheduled is the presence or absence of `scheduled_for`, not
  a second column or a type flag — one queue for the dispatcher, and no way
  for two fields to contradict each other.

## Dependencies

- `App\Concerns\BelongsToTenant`, `App\Concerns\Auditable`.
- `App\Models\User` — `requested_by_user_id`, `approved_by_user_id`.
- `Modules\Trips\Models\Trip` — the `trip()` relation, read-only from here.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode::INVALID_BOOKING_TRANSITION`.

## Public APIs

All behind `auth:sanctum` + `tenant` middleware. Decisions are POSTed as
named sub-resources rather than `PATCH`ing `status`: each carries its own
policy and its own required payload, and a raw status write would bypass
the transition check.

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/bookings` | `viewAny` — cursor-paginated; a Corporate Employee sees only their own requests. Filters: `status`, `dispatchable`, `q`, `from`/`to` (pickup date; an immediate booking counts on the day it was raised) |
| GET | `/api/v1/bookings/{id}` | `view` — desk roles see any; others only their own |
| POST | `/api/v1/bookings` | `create` — every role except Driver |
| POST | `/api/v1/bookings/{id}/approval` | `approve` — Super Admin, Operations Manager, Corporate Admin, Branch Manager |
| POST | `/api/v1/bookings/{id}/rejection` | `reject` — same roles; `reason` required |
| POST | `/api/v1/bookings/{id}/cancellation` | `cancel` — desk roles, or the requester withdrawing their own; `reason` required |
| POST | `/api/v1/bookings/{id}/assignment` | owned by `Modules/Dispatch` — see that README |

Dispatchers are deliberately excluded from `approve`: approving your own
workload is not a control, and PROJECT.md places approval with management.

## Booking lifecycle

```
Pending --> Approved --> Assigned
   |            |
   |            +-------> Cancelled
   +--> Rejected (terminal)
   +--> Assigned          (approval is optional per PROJECT.md)
   +--> Cancelled (terminal)
```

Rejected, Assigned and Cancelled are terminal. A refused booking is
re-raised as a new one rather than revived, so the original request and its
decision reason stay an untouched audit record.

## What's explicitly deferred

1. **Multi-stop and return trips** — PROJECT.md lists both under Booking
   Management; this pass models a single origin/destination pair only.
2. **Company departments, cost centres and employee directories** — the
   passenger is free text plus a phone number, not a foreign key into an
   employee table that does not exist yet (`Modules/Clients` holds only
   `Company`).
3. **Credit-limit checks at booking time** — `companies.credit_limit_minor`
   exists but nothing consults it; that belongs with `Modules/Billing`.
4. **Notifications on assignment.** Approval and rejection now notify the
   requester: `BookingService` dispatches `BookingApproved` and
   `BookingRejected` after the transaction commits, and
   `Modules/Notifications` listens. Assignment does not — that happens in
   `Modules/Dispatch`, and notifying the *driver* is blocked on drivers
   having no `user_id` linkage (`Modules/Trips` README, item 9). Notifying
   the requester that a vehicle was assigned is buildable and simply not
   built.

   Cancellation deliberately notifies nobody: it is usually the requester's
   own act, and telling somebody what they just did is the fatigue
   AGENTS.md warns against.
5. **Chauffeur service, self-drive, corporate-booking variants** — Phase 2+
   per PROJECT.md.
6. **Editing a booking after creation** — there is no `PATCH`. A booking
   with the wrong destination is cancelled and re-raised, which keeps the
   original request intact for audit. Revisit if dispatchers find that
   tedious in practice.
7. **A booking still requires a tenant and a requesting user.** Walk-in and
   individual riders have neither, so they remain unexpressible — named in
   ADR-0005 and again in ADR-0006, and unchanged by both.

## Frontend

`frontend/src/pages/BookingsPage.tsx` — the list, the New Booking dialog,
and the approve/reject/cancel actions. Approver-only buttons are hidden
based on role, but that is presentation only: the server still returns 403
regardless (AGENTS.md — never rely solely on frontend permissions).

## Notes

**Who is in range vs. what they may see.** `BookingController::index` asks
two separate questions, in this order: `Booking::forActor($user)` decides
*whose* bookings are in range — one client's for a client's user, every
client's for Shanitah's staff, who belong to no tenant (ADR-0006) — and the
`bookings.view.all` check then narrows anyone without it to what they
raised (ADR-0004). Keeping them separate is what stops "belongs to no
tenant" quietly becoming a permission: a platform account without
`bookings.view.all` sees the same nothing it would have seen inside a
tenant.

**The queue names its clients.** `BookingResource` carries `client`
(`{id, name}`) and the index reports `meta.scope` as `platform` or
`tenant`, the way `/audit-logs` already does. Both exist because ADR-0006's
own words are that a cross-client queue which does not show whose each row
is, is *worse* than no cross-client queue — the failure it prevents is not
a leak but a mistake, a vehicle committed to what a dispatcher read as the
Bank's airport run.

`client` is eager-loaded, and only for a platform reader: a client's own
queue is one client's, and joining to tell them their own name is a query
for nothing. `whenLoaded` omits the key entirely rather than sending null,
so a consumer can tell "not applicable" from "no client".
`CrossClientQueueLabellingTest` asserts the labels, the scope, the omission
and the absence of an N+1 — the last verified by making the resource read
the relation lazily and watching seven rows cost seven extra queries.

**`?tenant_id=` narrows to one client, and refusing it is security, not
validation.** The parameter is whitelisted only for a reader whose queue
spans clients; for everyone else it is not a recognised filter at all.

The rule that matters is that the refusal must not depend on the *value*.
`exists:tenants,id` was first applied to everybody, which meant naming a
real client produced one error and naming a nonexistent id produced two —
so any corporate employee could enumerate the platform's entire client
list one id at a time, without a single row leaking. `ClientFilterTest`
asserts the two responses are byte-identical, and it is the test that
caught it.

**`?q=` searches the whole queue, not the page in hand.** Route, passenger
and status, plus the client's name for a reader whose queue spans clients.
Two details in it are about `LIKE` rather than about search, and both
produce *more* rows than they should — the failure mode nobody notices:

- **Wildcards in the term are escaped** (`App\Support\Database\SearchTerm`).
  `%` and `_` are `LIKE` operators, and a passenger called `O_Brien` or a
  search for `50%` carries them innocently. Unescaped, the first matches
  every name of that shape and the second matches everything. Not
  injection — the value is still bound — but a wrong answer that looks
  exactly like a right one.
- **The OR group is nested.** `where(a)->orWhere(b)` chained onto the outer
  query escapes the surrounding AND, so `?q=Entebbe&status=cancelled` would
  return the Entebbe booking regardless of its status. `QueueSearchTest`
  asserts that combination specifically, and it was verified to fail with
  the nesting removed.

Statuses are matched the way they are *displayed*: the column holds
`trip_completed` and somebody reading the screen types "trip completed", so
spaces fold back to underscores before matching.

`meta.filters.clients` carries what the endpoint will accept, so the picker
holds no list of its own. It offers **every** client rather than the ones
on the current page — unlike `/audit-logs`' actors, because a picker that
could not reach the client further down the queue is useless for the reason
anybody opens it, and tenants are bounded at 50 by PROJECT.md where a
trail's actors are not.

`BookingCrossTenantIsolationTest` in `tests/Feature/Bookings/` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds for this
resource, including the dispatch sub-resource.
