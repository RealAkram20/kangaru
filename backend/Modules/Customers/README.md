# Customers

## Purpose

The second principal type (ADR-0013): identity for the platform's own
retail customers — the walk-ins of ADR-0012 — kept structurally apart
from the staff and corporate `User`.

## Responsibilities

- Customer registration and login (email + password), logout, and the
  customer's own account view.
- The customer's read of their own order requests — the status checker
  ADR-0012 deferred, delivered scoped-by-token instead of
  keyed-by-guessable-reference.
- The narrowed `CustomerOrderRequestResource`: what a walk-in sees of
  their request, minus the desk's internal fields (dispatcher notes,
  staff assignment, transition graph).

## Not this module's

- The `Customer` model lives in `app/Models` beside `User` and `Tenant`
  — principals are cross-cutting, and the `customer` guard in
  `config/auth.php` references it the way `users` references `User`.
- The guard split itself (`config/auth.php`, ADR-0013 §2) and its
  tripwire, `tests/Feature/Customers/CustomerGuardIsolationTest`.
- Writing order requests. The public POST stays in `Modules/Bookings`
  (it is a booking-shaped lead); this module only reads the rows that
  carry the caller's own `customer_id`.
- Google sign-in verification (ADR-0013 §3) — **deferred**, not shipped:
  the server-side JWKS verification endpoint does not exist yet, and the
  frontend's Google button remains a prefill. `customers.google_id`
  and the factory's `googleOnly()` state are ready for it.
- Password reset — deferred until a mail-delivery decision exists
  (ADR-0013 consequences). The UI says "contact the dispatcher".

## Dependencies

- `Modules/Bookings` for `OrderRequest` (read-only here).
- `Modules/Administration` for `InvalidCredentialsException`, reused so
  wrong-password and unknown-email stay one indistinguishable refusal on
  both auth surfaces.

## Public APIs

All under `/api/v1/customer`, all on the `customer` guard except the
first two (throttled 5/min/IP, like staff auth):

- `POST /auth/register` — create account, returns token (201).
- `POST /auth/login` — returns token.
- `POST /auth/logout` — revokes the current token.
- `GET /auth/me` — the caller's own account.
- `GET /order-requests` — own requests, newest first, paginated.
- `GET /order-requests/{id}` — one own request; foreign ids answer 404.
