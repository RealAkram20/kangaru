# ADR-0016: The account a driver signs in with

**Status:** Accepted (7 August 2026)

## Context

`drivers.user_id` has existed since shortly after the drivers table did. It
is read in three places by `Modules\Trips\Policies\TripPolicy` — it is how
the platform answers "is this trip yours?" — and until this ADR it could be
written by exactly nothing: not `StoreDriverRequest`, not
`UpdateDriverRequest`, no dedicated endpoint. `Modules/Drivers/README.md`
recorded it plainly and called it "the largest gap in this module":

> In practice a driver onboarded through the API today **cannot sign in to
> run their own trips.**

The consequence is larger than a missing screen. PROJECT.md's Phase 1
acceptance criteria are the Bank's six per-trip data points, two of which —
opening and closing odometer, with a dashboard photo — are captured *by the
driver*, at `Trip Started` and `Trip Completed`. A driver who cannot
authenticate cannot make those transitions. Every demonstration so far has
worked because the seeders write `user_id` directly; nothing that survives a
`migrate:fresh` on a real deployment does.

So the platform could onboard a driver and could not let that driver do the
one thing the anchor client is buying.

## Decision

### 1. Attaching a login is its own sub-resource, not a field

```
POST   /api/v1/drivers/{driver}/account
DELETE /api/v1/drivers/{driver}/account
```

The obvious fix — accept `user_id` on the driver form request — was
rejected for two reasons.

**It mints authority under the wrong permission.** Creating a login is
creating a user. Folding that into `drivers.manage` would let a Depot
Manager, who holds it, conjure accounts from the fleet screen. ADR-0004's
escalation rule (nobody grants what they do not hold) would be intact in
`Modules/Administration` and defeated by a side door in `Modules/Drivers`.

**It hides a security event inside a profile edit.** Both models are
`Auditable`; a `PATCH` that changes a phone number and silently grants
platform access produces one audit row that reads as routine.

### 2. Two permissions, then a third check on the role

`DriverPolicy::manageAccount` is the conjunction of `drivers.manage` (which
driver) and `UserPolicy::create`, i.e. `staff.manage` (may create logins at
all). Then `StoreDriverAccountRequest` asks `UserPolicy::assignRole` which
*role* the new account may land in, checked against the actor's own
permissions.

Three checks rather than one because they answer three different questions,
and collapsing them is how the escalation rule leaks.

The role defaults to the seeded `driver` slug but is a field, so ADR-0004's
custom roles are reachable — a "Relief Driver" carrying
`trips.transition.own` is a legitimate answer. Adoption of an existing
account is refused unless it holds that permission: linking one that does
not would produce a login that `TripPolicy` rejects on every transition,
which is the exact failure this ADR exists to end.

### 3. The link is exclusive on both sides, in the database

One driver profile, one account. Enforced by a unique index on
`drivers.user_id`, and refused by the service before the database has to so
the caller gets a sentence rather than an integrity violation. `user_id`
stays nullable — a driver without a login is a legitimate state, and MySQL
permits many NULLs in a unique index.

This is not tidiness. `TripPolicy::transition` authorises by comparing
`$trip->driver->user_id` to the caller, so a shared account could move *two*
drivers' trips — including recording one driver's odometer against another's
trip, which is the reading the acceptance criteria rest on.

### 4. Two shapes, mutually exclusive

`{email, password, role?, name?}` mints a new account. `{user_id}` adopts an
existing unlinked one — the way back for rows created by hand before this
endpoint existed, which are otherwise reachable only from a database
console. A request carrying both is refused rather than resolved, because
resolving it silently is how an administrator creates a second account for
somebody who already had one.

As in `StoreUserRequest`, the administrator sets the initial password rather
than the platform emailing an invitation: there is still no accept-invite
page, and a link to nowhere is worse than "tell them this and have them
change it".

### 5. Removing access takes effect now, not at token expiry

Three paths revoke, and all three revoke *tokens*, not just the link:

- `DELETE .../account` detaches and revokes. The account survives — removing
  somebody's login because they changed vehicles is a different and much
  larger act.
- Suspending the driver profile suspends the account and revokes. A driver
  marked `suspended` who can still sign in is suspended on paper only:
  `TripPolicy` asks whether the trip's driver is the caller, never whether
  that driver is allowed to drive today.
- Deleting the driver profile detaches first. `Driver` is soft-deleted, so
  without this the unique index goes on reserving the account against a row
  nobody can see, and re-hiring fails with a conflict naming a driver who
  appears not to exist.

Re-activating a driver deliberately does **not** restore the account.
It may have been suspended separately — a lapsed visa, a disciplinary
matter, a suspected compromise — and reversing that from a fleet screen is
the silent privilege restoration this codebase refuses elsewhere
(`UserAdminService` does not restore tokens either). Giving the login back
is an explicit act on the account.

### 6. The account is platform-level, always

ADR-0005 puts the fleet with the platform: a driver is Shanitah's employee,
not a client's. `tenant_id` is null and is not a parameter. Pinning a driver
to a tenant would both be false and hand that tenant's scoped reads to
somebody who is not theirs.

## Consequences

A driver onboarded entirely through the API can now sign in and complete the
odometer capture the Phase 1 acceptance criteria are made of. This was the
last thing standing between "the API can onboard a driver" and "that driver
can work".

`DriverResource` gains an `account` object — id, email, role, status, and
never any password material. It is always present and null when absent, so a
screen can tell "no account" apart from "not requested"; a key that appeared
only sometimes would render an Attach button to a driver who already had
one.

Three things this deliberately does not do. There is no self-service driver
sign-up: accounts are issued, like every other account here. There is no
password reset for somebody else, for the same reason `Modules/Administration`
offers none — an administrator silently changing another person's
credentials is the one act an audit trail cannot tell apart from
impersonation; a driver who forgets theirs gets a new one issued and knows
it happened. And MFA is not required of drivers, per PROJECT.md's Phase 1
scope, which confines it to Super Admin and Finance.

## Alternatives considered

**`user_id` on the driver form request.** Rejected above: wrong permission,
wrong audit shape.

**Creating the account automatically with every driver.** Tempting, and
wrong: it forces an email address on a profile that does not require one
today, and it mints a credential for the many drivers a fleet records but
does not yet equip with a phone.

**A `drivers.accounts.manage` permission of its own.** Considered and
rejected as ceremony. The two existing permissions already say exactly the
two things that need saying, and a third would have to be seeded onto the
same roles that hold both — a new name for an existing conjunction.

**Letting the account be any role at all.** Rejected: a login that
`TripPolicy` refuses on every request is indistinguishable, to the person
holding it, from a broken app.
