# ADR-0004: Permission-Based Authorization with Custom Roles

**Status:** Accepted

**Supersedes:** the implicit decision, never recorded, that the ten roles in
`App\Enums\UserRole` are the whole authorization model.

## Context

PROJECT.md's first product module is "Identity & Access Management —
authentication, authorization, roles, permissions", and lists ten Phase 1
roles. What was built is narrower than that sentence: the ten roles are a
PHP enum, and permission is expressed as **79 role comparisons** spread
across 9 policies, 4 controllers, 3 form requests and a service.

That has three consequences we can no longer live with:

1. **Roles cannot be created.** A client who wants a "Regional Dispatcher"
   or a "Read-only Auditor" cannot have one without a release.
2. **Permission is not inspectable.** "Who can issue an invoice?" is
   answered by reading nine files, not by a query. For a bank's vendor
   security questionnaire that is a bad answer.
3. **The rules drift.** `InvoicePolicy::READERS` and
   `RateCardPolicy::RATE_VIEWERS` are the same four roles written twice;
   nothing makes them stay the same, and the frontend keeps a third copy in
   `lib/navigation.ts`.

## Decision

**Authorization is by permission. Roles are data that carry permissions.**

- `App\Enums\Permission` is the catalogue of abilities. It stays in code,
  because a permission only means something if a policy checks it — a
  permission invented in the database would grant nothing, which is worse
  than not existing.
- `roles` is a table. The ten Phase 1 roles are seeded as **system roles**;
  they may be edited but not deleted or renamed, because `users.role`
  values, seeders and every existing test refer to them by slug.
- A role carries its permissions as a JSON array of catalogue values,
  validated against the enum on write. A `permission_role` pivot was the
  alternative; it buys referential integrity against a catalogue that lives
  in code anyway, at the cost of a third table and a sync step. The JSON
  column keeps a role's grant readable as one row, which is also what makes
  the audit diff legible.
- Policies ask `$user->hasPermission(Permission::X)`. Role identity
  survives only where the question genuinely is identity rather than
  ability — "is this the driver on this trip" is ownership, not permission,
  and is expressed as a `*.own` / `*.all` permission pair instead.
- **Custom roles are platform-wide and Super Admin only.** One curated
  catalogue every tenant picks from. A tenant cannot invent permissions for
  itself, which keeps the escalation surface to a single role.

### The escalation rule

**Nobody may grant a permission they do not themselves hold.** A role may
only be assigned by someone whose own permissions are a superset of it.

This replaces the special case that only a Super Admin may appoint a Super
Admin — it generalises it, and it closes the hole that special case did not
cover: a Corporate Admin could otherwise mint a custom role holding
`roles.manage` and assign it, reaching platform control by another door.

**Why a subset and not just a ban on `roles.manage`.** Because an
administrator sets the new account's initial password. Anyone who can
create an account in a role and then sign in as it has, in effect, granted
themselves that role. A weaker rule — "you may not grant role-editing" —
would leave `staff.manage` plus a chosen password as a route to any
permission in the catalogue.

**This is the one place behaviour deliberately changes.** Everywhere else
the seeded grants reproduce the old role comparisons exactly. Here they do
not: a Corporate Admin used to be able to assign any role except Super
Admin, and can now assign only roles contained by their own — in practice
Corporate Employee and Corporate Admin. Onboarding a Dispatcher or a
Finance officer is no longer something a Corporate Admin can do alone.

That is a real reduction in what a tenant administrator can do, and it is
accepted rather than worked around, because the alternative is a standing
privilege-escalation path. The remedy is the feature itself: a Super Admin
composes a role that holds `staff.manage` **and** the permissions that role
should be able to hand out, and gives it to whoever runs onboarding. What
was a hardcoded exception becomes a configuration decision with a name.

## Consequences

**The migration is the risk.** 79 authorization points change at once, and
a mistake here is a privilege escalation rather than a broken page. It is
mitigated by: seeding the system roles with exactly the permission sets the
old enum comparisons produced, so behaviour is unchanged on day one; and by
a test that asserts, role by role, that every endpoint answers exactly as it
did before.

**`users.role` stays.** A `role_id` foreign key is added alongside it and
backfilled, per the zero-downtime rule — additive first, never a rename in
one step. The string column remains the human-readable slug and the thing
seeders and tests set.

**Permission checks are a hot path.** A user's permissions are resolved once
per request and memoised on the model. No query per `can()`.

**The frontend still keeps a copy**, in `lib/navigation.ts`. It is still
convenience and not authorization, but it should be served from the API
rather than hardcoded once roles are data — noted, not built here.

## Alternatives considered

**Named variants of a base role** — a custom role as a label over one of
the ten built-ins. Cheap, zero policy changes, and honest about being a
naming feature. Rejected because it cannot express "dispatch but not see
Companies", which is the request.

**Staged migration behind a shim** — build the catalogue and tables, migrate
policies module by module. Lower risk per pass and the recommended path.
Rejected by the owner in favour of doing it once, on the grounds that a
half-migrated authorization model is its own hazard: two sources of truth
for who may do what, live at the same time.
