# ADR-0065: A fleet administers its own people

**Status:** Accepted — 25 August 2026

**Amends:** ADR-0006 (platform staff and cross-tenant reads). Its Decision 2
and its `forActor()` scope stand unchanged; what changes is the *policy* that
was written beside them and never moved when ADR-0055 split the axes.

**Depends on:** ADR-0055 (`access_level`, fleet and client as independent
axes), ADR-0060 §4 (asking to serve a client grants no read).

## Context

`UserPolicy` decided whether one account may administer another with two
lines:

```php
if ($user->isPlatformLevel()) {
    return true;
}

return $user->tenant_id === $subject->tenant_id;
```

That was a correct description of the system it was written for. ADR-0006
landed on 2 August, when *platform-level* meant Shanitah, Shanitah was the
platform, and "administers everyone" was simply what head office did.

ADR-0055 then made `isPlatformLevel()` mean `access_level === FLEET`. The
sentence did not change; its meaning did. From that moment the policy read
**every fleet administers everyone** — a decision nobody took and nothing
recorded.

### Why the listing being right did not save it

`User::scopeForActor()` was narrowed on 23 August, the day the second fleet
was onboarded, and its comment records the near-miss: a fleet's staff listing
had been returning every client's employees on the platform.

The *record* was not narrowed with it, and `User` deliberately carries no
global scope — login has to find an account by email before any organisation
is known. So `GET /users/{user}` and `PATCH /users/{user}` resolve any id in
the table, and this policy is the entire distance between a resolved id and
somebody else's name, email, phone number and account status.

`POST /users` had the write mirror of the same hole: `tenant_id` was validated
as *existing* and nothing more, so a fleet could name any client on the
platform and create a working account inside it.

**Both were confirmed by execution before anything was changed** — five
failing tests against the unmodified code, not a reading of it.

### What made it survivable, and what was about to end that

Only one live account could reach any of it: Shanitah's own fleet-level
`super_admin`, which is the house's. The second fleet's owner could not,
because `fleet_owner` holds no `staff.*` permission at all.

That is not a defence. It is a coincidence, and
`docs/org-staff-and-roles-plan.md` exists to remove it: giving fleet roles
`staff.manage` is the whole point of the work in flight, and it would have
converted a latent hole into a live one for every fleet on the platform.

This is the third time this shape has appeared. The comment left on
`scopeForActor` in August says it best: *"nothing leaks today because there is
one fleet, which is exactly the kind of gap that ships."* It shipped once for
that reason already.

## Decision

**The policy answers the same question as the scope beside it, level by
level.**

| Actor | May administer |
|---|---|
| `fleet` | its own people, **plus** the people of clients it *actively* serves |
| `client` | its own people |
| `kangaru` | head-office accounts only |
| `applicant` | nobody |

Expressed as an exhaustive `match` on `AccessLevel`, so a fifth level cannot
be added without every arm being considered — the property ADR-0055's
amendment already relies on in four other files.

### 1. Active contracts only

`servedBy` selects `active` rows. A fleet that has merely *requested* a client
reaches nobody there.

ADR-0060 §4 refused the read on the grounds that asking is free and needs
nobody's consent. The same argument forbids the write, and more strongly: a
planted account is a standing credential inside another organisation, and it
outlives the request that created it.

### 2. Head office reaches head office, and no further

`kangaru` administers `kangaru`. Reaching into a fleet is ADR-0056's act-as —
which arrives as a named person at that fleet, scoped as them, under a banner
they can see, with `impersonator_id` in the audit trail.

This costs support nothing it should have had. A cross-fleet `UPDATE` leaves
no banner and no name.

### 3. A 422 for the client, a 403 for the person

Creating an account inside an unserved client is a validation failure, not an
authorization one: the actor may create accounts, and it is *this client* they
may not create one in. Reaching another fleet's person is a 403, because the
subject is not theirs to touch at all.

## Consequences

**The policy and the scope must now be read together.** They answer one
question in two places, and the failure mode is silent: a policy more generous
than the scope beside it is a hole no listing test can see. The
`CrossFleetIsolationTest` write mirror is what holds them in step, and it
carries the positive control that stops the whole set passing against a policy
that refuses everybody.

**One behaviour genuinely changes for an existing account.**
`help@kangaruride.com` — Shanitah's fleet-level Super Admin — can no longer
open or edit accounts belonging to Najjemba or to any client Shanitah does not
serve. That is the fix, not a side effect, and it is named here because it is
the only account on the platform that will notice.

**A fleet-level Super Admin is no longer a platform Super Admin.** The role
slug is the same and its 42 permissions are unchanged; what bounds it is the
*level*, exactly as `RoleSeeder`'s note on `support.act-as` already argues —
*"what actually keeps it narrow is the level"*. Anybody expecting the slug
alone to mean unlimited reach will be surprised, and should be.

**`isPlatformLevel()` is now doing less work than its name suggests.** It
survives here only inside `StoreUserRequest`, where it means "an actor whose
`tenant_id` field is read at all". Renaming it is a 37-call-site change and is
not attempted in a security fix.

## Alternatives considered

**Scope `User` route-model binding instead of fixing the policy.** Would close
the read and the edit in one place. Rejected: `User` cannot take a global
scope — login resolves an account by email before any organisation is known —
and an actor-aware `resolveRouteBinding` would answer 404 where the honest
answer is 403. AGENTS.md reserves the 404 mask for cross-*client* ids, so
clients cannot probe each other; a fleet is not another client's probe.

**Leave the policy and simply never grant fleet roles `staff.manage`.** Free,
and it describes today exactly. Rejected because it makes the safety of the
system depend on a permission nobody has yet been given, which is the same bet
that lost twice already — and because granting it is the feature the owner
asked for.

**Give head office a cross-fleet read over accounts, for support.** The
obvious convenience. Rejected for the reason ADR-0059 §4 already rejected it
one level up: read-only does not answer the objection, because the problem
with a cross-fleet read is not that it writes — it is that it is silent and
unbounded.
