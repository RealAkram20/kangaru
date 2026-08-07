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

## The staff-side register (ADR-0018)

Customers could register, order and sign in, and no member of staff could
see they existed. This is the other half.

| Method | Path | Policy |
|---|---|---|
| GET | `/api/v1/customers` | `viewAny` — `customers.view` |
| GET | `/api/v1/customers/{id}` | `view` — same |
| GET | `/api/v1/customers/{id}/activity` | `view` — their order requests, newest 50 |
| POST | `/api/v1/customers/{id}/suspension` | `suspend` — `customers.manage`, reason required |
| DELETE | `/api/v1/customers/{id}/suspension` | `suspend` — same |

Deliberately **not** under `/customer`: that prefix marks the customer
guard's own surface, and these run behind the staff guard. The URL should
not lie about who the caller is.

`customers.view` is its own permission rather than part of `staff.view`.
Staff are colleagues; customers are members of the public covered by the
Data Protection and Privacy Act, 2019. A **Corporate Admin holds neither**
— their staff are in `/users`, and Shanitah's retail customers are not
theirs to read.

Search matches name, email and phone. The phone comparison uses the
**national significant number** (last 9 digits), so `0700123456`,
`700123456` and `+256 700 123 456` all find the same person — a substring
match does not, because a local leading zero replaces the country code.

Suspension revokes every token and refuses the next sign-in with the
ordinary wrong-credentials answer, so the login form cannot be used to
enumerate accounts in trouble. Restoring clears the reason with the status.

Nothing here lets staff act *as* a customer: no password reset, no
impersonation, no profile edit. The profile does say **how** somebody signs
in (`has_password`, `has_google`) without saying what the credential is.

Frontend: `frontend/src/pages/CustomersPage.tsx`.

