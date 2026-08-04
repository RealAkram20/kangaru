# ADR-0013: Customer Accounts for Walk-In Orders

**Status:** Proposed (draft — needs owner approval; customer accounts sit
on PROJECT.md's deferred list, and moving an item off that list is the
owner's call, as ADR-0012's own approval established)

**Depends on:** ADR-0012 (walk-in order requests are platform data),
ADR-0005 (walk-in customers are the platform's customers, not a tenant's),
ADR-0004 (permission model — which this ADR deliberately does **not**
extend to customers), ADR-0011 (every new endpoint lands in the contract).

## Context

ADR-0012 shipped the ask-by-form, dispatch-by-phone loop and explicitly
deferred two things: an identity for the person asking, and any way for
them to see their request again. Both deferrals are now the next thing a
visitor bumps into. The order flow briefly grew a signup step in
anticipation — password fields validated client-side and stored nowhere,
a log-in mode that could only apologise — and it was removed for the
reason ADR-0012 gave: collecting a credential before an endpoint exists
to honour it is pretending, and a stored-nowhere password is a secret
people reuse.

There is also a structural pressure. ADR-0012 rejected a public status
checker because a `KR-` + 6-char reference is guessable, and an endpoint
keyed by it is an enumeration surface. The safe version of that feature
needs the caller to prove who they are — which is this ADR.

The question this ADR settles: **who is a customer in a system whose
every authenticated actor is a staff or corporate `User`?**

## Decision

**A customer is a separate principal.** Their own table, their own guard,
their own token type. They hold no role, no permission, and no tenant.
Everything a customer can do is scoped to "their own rows" by
construction, not by policy checks that could drift.

### 1. Not rows in `users`

`users.role` maps into the role catalogue; policies, the staff list, the
role editor, the nav map and `RolePermissionParityTest` all assume every
`User` is one of ADR-0004's actors. A customer wedged in there would need
a fake role, and every one of those surfaces would need to special-case
it forever — the same shape of mistake as the pseudo-tenant ADR-0012
rejected. Instead: a `customers` table — name, phone, unique email,
nullable password hash, nullable `google_id`, timestamps. **No
`BelongsToTenant`**, per ADR-0005: the walk-in customer is the platform's
customer, like the fleet and like `order_requests`.

### 2. A separate guard, so isolation is structural

A second Sanctum guard (`auth:customer`) backed by the `customers` model.
A customer token authenticates only customer routes; a staff token
authenticates only staff routes. The "walk-ins see only what they need
to see" guarantee is then a property of the auth layer — a customer
request cannot even *reach* a staff policy, and no future policy can
accidentally widen customer access, because there is no permission for it
to grant. The isolation suite gains the mirror pair: a customer token on
every staff route group answers 401, and a staff token on customer routes
likewise.

### 3. Two ways in, both proving something

- **Email + password.** Registration takes name, phone, email, password;
  login returns a customer token. Same throttles as staff auth (5/min/IP),
  same single invalid-credentials message for wrong password and unknown
  email alike.
- **Google.** The SPA sends the ID token to the server, which verifies it
  against Google's published keys (issuer, audience, expiry, signature)
  before trusting a byte of it. The client-side decode that prefills the
  order form stays what it is — a prefill. `google_id` links repeat
  sign-ins; an email collision with an existing password account links
  only after the password proves ownership.
- **No SMS anywhere** (AGENTS.md: SMS pumping). Phone stays a contact
  field the dispatcher dials, not a verification channel.

No MFA for customers in this phase: ADR-0008's requirement is tied to
roles that move money, and a customer cannot.

### 4. Orders link to the customer, and anonymity survives

`order_requests.customer_id`, nullable, `nullOnDelete`. The public POST
keeps working with no token — the anonymous walk-in is the product, not a
degraded mode — but when a customer token accompanies it, the server
stamps the link. `GET /me/order-requests` and `GET /me/order-requests/{id}`
(customer guard, scoped to the token's customer) deliver the status
checker ADR-0012 deferred, without the enumeration surface: the reference
is display-only, and the id is only resolvable inside your own rows.

### 5. The dispatcher's view grows one field

`OrderRequestResource` gains the linked customer's name — the queue can
show "3rd order from this customer" instead of the dispatcher
re-recognising a phone number. Nothing else changes on the staff side;
`order_requests.manage` and the platform-level check stand as they are.

### 6. Every endpoint lands in the contract

Per ADR-0011, the customer auth and `/me` endpoints are written into the
OpenAPI contract in the same change that creates them, and the drift gate
holds.

## Consequences

- The order flow can honestly offer "create an account" and "log in"
  again — this time backed by endpoints — and an anonymous order remains
  one tap fewer.
- A second principal type exists. Every future feature that says "the
  user" must now say which kind; the guard split makes the compiler-ish
  answer the default answer.
- `customers` is platform data readable in the dispatcher queue, so the
  privacy posture of ADR-0012 §3 extends to it: no public read of any
  customer field, ever.
- Wallets, payments, live fares, PIN-confirmed delivery, and converting a
  request into a Trip stay deferred, each behind its own ADR. This ADR
  adds identity, nothing that moves money.
- Password reset for customers needs email delivery, which the platform
  does not send yet. Until a mail decision exists, reset is "contact the
  dispatcher" — honest, and stated in the UI — rather than a silent
  half-feature.

## Alternatives Considered

**Customers as a `customer` role in `users`.** One table, one guard, no
new model. Rejected: every staff surface keys on `users`, and each would
need to learn to exclude customers; the permission model would carry an
actor it must never grant anything to. Separation by table is the same
call ADR-0012 made for data ownership, applied to identity.

**Capability-URL status checking (long random reference, no accounts).**
Cheaper, and ADR-0012 named it. Rejected as the *primary* path: it solves
read-back but not identity, so the signup pressure on the order flow
returns with the next feature. It remains a fine future addition for the
customer who refuses an account.

**Phone-OTP identity.** The regional default. Rejected on the standing
no-SMS posture; revisit only if a mail/SMS provider decision changes it.
