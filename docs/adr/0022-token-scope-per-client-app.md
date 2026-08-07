# ADR-0022: Token abilities scoped per client app

**Status:** Accepted (7 August 2026)

## Context

AGENTS.md has said, since before there was a second client: *"Sanctum tokens
with expiry; token abilities scoped per client app when the driver app
ships."* It ships now — `docs/driver-app-brief.md` briefs the React Native
agent, and ADR-0016 gave drivers real `User` accounts to sign in with.

Until today every token this platform issued was identical. `createToken('api')`
with no abilities, which Sanctum reads as `['*']`: a token minted for a phone
in a taxi could list users, read the customer register, and page through the
invoice ledger, subject only to the role behind it.

The role is a real defence and it is not this one. Permissions answer *what
is this person allowed to do*; they have nothing to say about *what is this
credential for*. Those diverge the moment one person holds two. A depot
manager who also drives has one account and, from today, two apps — and the
token on the app that lives in a vehicle, gets handed to a mechanic, and is
backed up to whatever cloud the handset defaults to should not be the same
key as the one behind a browser on a desk.

This is far cheaper now than later. Scoping tokens after an app has them in
the wild means either a flag day or a migration of live credentials.

## Decision

### 1. The client is a field on login, and it is self-declared

`POST /auth/login` and `POST /auth/mfa/verify` accept
`client: console | driver`. Absent means `console`, so the shipped web app
and every existing integration keep the unscoped token they have always had.
This is additive by construction: only a client that asks to be scoped is.

Self-declared is a real limitation and stating it plainly is better than
implying a guarantee that is not there. **It is not a defence against the
person signing in.** Anyone who can obtain a driver token can obtain a
console token instead, by sending a different string — exactly as they could
open the web console in a browser. Nothing here changes what a person may do.

What it bounds is what a **token** can do. The threat it answers is a
credential at rest in the wrong place: a stolen handset, a mobile app's
storage, a proxy log, a crash report. In every one of those the attacker has
the token and not the password, and the token is now worth much less.

The alternative — deriving the client from the User-Agent, or issuing the
mobile app a secret — was rejected in "Alternatives".

### 2. An allow-list of route names, fail-closed, in one file

`App\Support\Auth\ClientScope` names the routes a driver-app token may
reach. Nineteen of them, by route name, in one place that reads as the
Driver's Application's entire API surface.

Fail-closed is the whole decision. **A route not on the list is refused**,
which means every endpoint added to this API from today is shut to the
driver app until somebody puts it on the list deliberately. A deny-list has
the opposite property: a new endpoint is open to every token until somebody
remembers to close it, and nothing fails when they forget. Both designs
have a failure mode; only one of them is silent.

The visible cost is that the mobile team will occasionally hit
`403 TOKEN_SCOPE_EXCEEDED` on something they legitimately need, and have to
ask. That is the intended cost. It is a conversation about what the driver
app is for, held once per endpoint, and it is cheaper than the alternative
conversation.

Route *names*, not URL prefixes. `/trips` would have to admit `POST /trips`
— creating a trip is dispatch's act, not a driver's — and a prefix cannot
tell those apart. Names also survive a URL change.

`trips.store` is absent for that reason; `users.*`, `customers.*`,
`invoices.*` and the availability *office* endpoints are absent because a
driver app has no business with any of them. `live-positions.index` is
present and safe: it is already scoped to trips the caller can see
(ADR-0019), so a driver gets their own vehicle.

### 3. Middleware over the whole authenticated API, not markers on routes

`EnforceTokenScope` runs after authentication on every API route. The
inversion matters for the same reason as §2: marking the allowed routes
would put the decision in the same place as the mistake.

It sits in the priority list immediately after `AuthenticatesRequests`, so
the refusal lands **before** the policy check. A super admin on the driver
app gets `TOKEN_SCOPE_EXCEEDED`, not `INSUFFICIENT_PERMISSIONS` — which is
both the honest answer (their permissions are fine; their app is not) and
the thing that makes the feature testable at all. A test written against a
driver-role token alone would pass with this entire ADR deleted, because
the role would refuse everything anyway. `tests/Feature/Auth/TokenScopeTest.php`
signs a super admin in on the driver app for exactly that reason.

Console tokens hold `*` and return from the middleware immediately.

### 4. `*` for the console, deliberately

Enumerating the console's routes would be a second copy of the route table,
drifting every time somebody adds a screen, and the failure would show up as
a working feature that 403s for no reason a user could understand. The
console also runs in a browser at a desk the person is already sitting at, so
the token buys an attacker nothing the session did not already give them.

### 5. The token's name is the client

`createToken($client, ...)` rather than `createToken('api', ...)`. Every row
in `personal_access_tokens` used to say "api", which is worthless during the
one incident when somebody is reading that table and needs to know which
device a row belongs to.

### 6. The client is re-declared at MFA verify, not carried on the challenge

An MFA-required login mints its token in `verifyMfa`, not in `login`. The
client has to reach that call somehow, and persisting it on the challenge
would mean a column and a migration to protect something that — per §1 — is
self-declared anyway and offers no guarantee against the caller. So the
second step asks again. Getting this wrong would have been quiet and bad:
every MFA-protected person signing in on the driver app would have received
a console token, with nothing failing. There is a test on that specific
path.

## Consequences

A driver-app token reaches nineteen route names and answers
`403 TOKEN_SCOPE_EXCEEDED` on everything else, regardless of the role behind
it. Losing a handset stops being a question about what that driver was
allowed to do.

The staff console is untouched — it sends no `client`, gets `*`, and behaves
exactly as before. Nothing in the existing suite changed.

`docs/driver-app-brief.md` now instructs the mobile agent to send
`client: "driver"`, lists the nineteen routes, and says what to do on
`TOKEN_SCOPE_EXCEEDED` (raise it, do not work around it).

**New endpoints are closed to the driver app by default.** Anyone adding one
that the app needs must add it to `ClientScope::routesFor()`. This is the
intended friction and the mobile brief warns about it.

Deferred, and named rather than implied:

- **A third client.** Adding one is a constant plus a list. The customer
  portal deliberately does not use this — it authenticates through a separate
  guard (ADR-0013) and is already isolated.
- **Per-token scoping chosen by the user** ("this device may only do X").
  That is a product feature, not a security primitive, and needs a UI.
- **Shortening the driver token's expiry below the platform's 24 hours.** A
  driver upcountry re-authenticating mid-shift on bad coverage is a real
  operational cost; the right lever is a refresh token, and that is its own
  decision.
- **Revoking a specific device from the console.** The data is there —
  tokens are now named by client — but the screen is not, and nobody has
  asked for it yet.

## Alternatives considered

**Deriving the client from the User-Agent.** Trivially forged, and worse,
silently wrong: an Expo dev build, a proxy, or an OS upgrade changes the
string and a working app starts 403ing. A field the client sets on purpose
is both more honest and more stable.

**Issuing the mobile app a client secret.** A secret shipped inside an app
binary is not a secret; it is a delay. It would have bought the appearance
of a guarantee §1 is careful not to claim.

**Relying on role permissions alone.** What the platform did. It cannot
distinguish two credentials held by the same person, which is the entire
threat.

**A deny-list of console-only routes.** Rejected in §2 — the failure is
silent and arrives with a feature nobody was thinking about.

**Scoping by URL prefix instead of route name.** Rejected in §2 — cannot
separate `GET /trips` from `POST /trips`, and the difference between reading
your work and inventing work is not cosmetic.

**Waiting until the driver app is in production.** Rejected in Context —
scoping credentials already in the field is a migration; scoping them before
they exist is a field on a form.
