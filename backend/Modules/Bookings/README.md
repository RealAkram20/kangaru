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
| GET | `/api/v1/bookings` | `viewAny` — cursor-paginated; a Corporate Employee sees only their own requests. Filters: `status`, `dispatchable` |
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
7. **Cursor paging in the UI** — the API is cursor-paginated but
   `BookingsPage` renders only the first page; there is no "load more" yet.

## Frontend

`frontend/src/pages/BookingsPage.tsx` — the list, the New Booking dialog,
and the approve/reject/cancel actions. Approver-only buttons are hidden
based on role, but that is presentation only: the server still returns 403
regardless (AGENTS.md — never rely solely on frontend permissions).

## Notes

`BookingCrossTenantIsolationTest` in `tests/Feature/Bookings/` is the
AGENTS.md-mandated, non-skippable proof that tenant isolation holds for this
resource, including the dispatch sub-resource.
