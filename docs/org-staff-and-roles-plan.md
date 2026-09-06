# Staff of their own: a fleet, a client and Kangaru each add their people

**Owner's ask, 25 August 2026:** *"we want for both coporate clients and fleet
superadmins to add member from thier staff if needed — so the Kangaru can
create both roles for each either coporate clients and fleet clients so the
staff can access what is given to them. remember we can also have multi staff
on the kangaru side."*

**Depends on:** ADR-0004 (permission-based authorization), ADR-0055
(`access_level`, the two axes), ADR-0006 (platform staff), ADR-0059 (three
consoles). **Amends** two of them — see §5.

**Decisions taken by the owner before this plan was written** (§4 carries the
alternatives that lost):

1. A role is tagged with the **audience** it is for — `kangaru`, `fleet`,
   `client`. One catalogue, composed by Kangaru, as ADR-0004 requires.
2. A new colleague is reached **either** by an emailed invitation **or** by an
   initial password the administrator sets. The administrator chooses.
3. **One release**, not four.

---

## 1 · Most of this is already built, and that is the point of §1

Nobody should rebuild these. Verified by reading the code and by querying the
live database on 25 August.

| Already working | Where |
|---|---|
| Staff list, create, edit, suspend | `GET/POST /users`, `PATCH /users/{user}` — `Modules/Administration/Controllers/UserController.php` |
| The staff screen, with a server-supplied role picker | `frontend/src/pages/StaffPage.tsx` — roles arrive as `meta.assignable_roles`, the screen keeps no copy |
| The role catalogue, with custom roles | `RoleController`, `frontend/src/pages/RolesPage.tsx` |
| **A corporate client adding its own staff** | `corporate_admin` holds `staff.view` + `staff.manage`; `UserAdminService::insert()` forces `tenant_id` to the actor's own |
| The `manages_staff` switch for a client colleague who is not an admin | `App\Enums\ClientCapability` |
| Staff **reads** scoped correctly at all four levels | `User::scopeForActor()` — narrowed on 23 August when the second fleet landed |
| Invitations: signed token, 7-day expiry, public accept page, reminders | `Modules/Administration/{Models,Services}/Invitation*`, `AcceptInvitePage.tsx` |
| The escalation rule, enforced in four places | role definition, role edit, role assignment, capability grant |
| A `Staff` entry in all three menus | `lib/menu/{kangaru,fleet,client}.ts` |

**So the client half of the owner's request substantially exists.** What does
not exist is the fleet half, the Kangaru half, and any notion of *which
audience a role is for*.

## 2 · What is actually missing — with the live evidence

The live database, 25 August, all four accounts:

| Account | Level | Fleet | Role | `staff.manage` |
|---|---|---|---|---|
| `help@kangaruride.com` | fleet | Shanitah (1) | `super_admin` | **yes** |
| `info@armgenius.com` | fleet | Najjemba (2) | `fleet_owner` | no |
| `driver@kangaruride.com` | fleet | Shanitah (1) | `driver` | no |
| `rio@armgenius.com` | kangaru | — | `super_admin` | yes |

### G1 · A fleet owner cannot add anybody

`fleet_owner` holds 14 permissions and **none of them is `staff.*`**
(`RoleSeeder.php:178`). Najjemba's owner cannot add a dispatcher, a depot
manager, or a second administrator. This is the owner's complaint, exactly.

The *plumbing* is already right — `UserAdminService::insert()` gives a new
account `operator_id = $actor->operator_id` when no client is named, so a
fleet actor creating a colleague already lands them in the correct fleet. What
is missing is the permission, not the mechanism.

### G2 · Kangaru cannot add staff through the console at all

`UserAdminService::insert()` computes `operator_id` from the actor, and a
`kangaru` actor has none. The result is two nulls, which `User::levelFor()`
refuses by design (ADR-0055 §4) — so `POST /users` **500s** for head office.
The docblock says so and says the fix "arrives with S1"; S1 shipped only
`php artisan kangaru:create-staff`, a console command. The menu entry
"Kangaru staff" therefore leads to a screen that can list but never add.

### G3 · A role does not say who it is for

`roles` has `slug, name, description, is_system, requires_mfa, permissions` —
and no column saying whether a role is meant for head office, a fleet, or a
client. Today the only thing keeping `corporate_admin` out of a fleet's picker
is the escalation subset rule, which is a **coincidence of permission sets**,
not a statement of intent. The moment Kangaru composes "Fleet HR" and
"Client Approver" as the owner asks, both appear in both pickers wherever the
subsets happen to allow it.

### G4 · The hole this feature would open — read this before writing any code

`UserPolicy::sharesTenant()` (`UserPolicy.php:99-110`):

```php
if ($user->isPlatformLevel()) {
    return true;              // isPlatformLevel() === (access_level === FLEET)
}
return $user->tenant_id === $subject->tenant_id;
```

**Every fleet-level actor holding `staff.manage` may `view` and `update` every
account in the system** — another fleet's owner, another fleet's drivers, any
client's staff. `User` deliberately carries no global tenant scope, so
route-model binding on `GET|PATCH /users/{user}` resolves any id, and this
policy is the only thing standing after it. The listing is narrowed by
`User::scopeForActor()`; the single-resource routes are not.

`POST /users` has the mirror of it: `StoreUserRequest`'s `tenant_id` rule is
`exists:tenants,id` with **no check that the actor's fleet serves that
client**, so a fleet may create an account inside a client it has no contract
with.

**Today only `help@kangaruride.com` can reach any of this**, because it is the
one fleet-level account holding `staff.manage`, and it is the house's own.
Najjemba's owner cannot — they hold no `staff.*`, which is G1.

**G1 and G4 are the same fact seen from two sides.** Granting fleet roles
`staff.manage`, which is the whole point of this work, converts a latent hole
into a live one for every fleet on the platform. It is the identical shape as
the read leak found on 23 August — *"nothing leaks today because there is one
fleet, which is exactly the kind of gap that ships"* — and it shipped once
already for that reason.

**Status: confirmed by reading the code, not yet by executing it.** The first
task of S0 is a test that fails, proving the reach is real, before a line of
the fix is written. Per `screen-rules.md` §8 and the house rule that a guard is
only as deployed as its call sites.

---

## 3 · The work

One release, one branch, in this internal order. The order is not a preference:
S0 must land before R2 grants any fleet role `staff.manage`.

### S0 · A fleet administers its own people, and nobody else's

**Backend only. Nothing else in this plan may merge ahead of it.**

- A failing test first: a fleet-level `super_admin` at Shanitah reaching
  Najjemba's owner by `GET /users/{id}` and `PATCH /users/{id}`, and creating
  an account inside a client Shanitah does not serve.
- `UserPolicy::sharesTenant()` replaced by a level-aware predicate mirroring
  `User::scopeForActor()`, so the policy and the query answer the same
  question:
  - `FLEET` → same `operator_id`, **or** a `tenant_id` this fleet actively
    serves (`OperatorClient::servedBy`, active contracts only, ADR-0060 §4);
  - `CLIENT` → same `tenant_id` (unchanged);
  - `KANGARU` → `access_level === KANGARU` only (head office administers head
    office; reaching a fleet is act-as, ADR-0056);
  - `APPLICANT` → nobody.
- `StoreUserRequest`'s `tenant_id` gains the same `servedBy` constraint.
- Extend `tests/Feature/Fleet/CrossFleetIsolationTest` with the **write**
  mirror, and prove each new guard by mutation.

**Exit:** the failing tests pass; Shanitah's super admin gets 403 on
Najjemba's owner; `php -d memory_limit=1G vendor/bin/pest` whole.

### R1 · A role says who it is for

- Migration: `roles.audience` — `kangaru` | `fleet` | `client`. Not nullable;
  a role with no audience is a role in nobody's picker, which is the same
  fail-open shape ADR-0055 §4 refuses. Backfill the ten system roles
  explicitly, by name, in the migration.
- `App\Enums\RoleAudience`, exhaustive `match` everywhere it is read.
- `RoleSeeder` tags all ten: `super_admin` → `kangaru`; `operations_manager`,
  `dispatcher`, `finance`, `fleet_owner`, `branch_manager`, `depot_manager`,
  `driver` → `fleet`; `corporate_admin`, `corporate_employee` → `client`.
- `UserController::assignableRoles()` filters by **the actor's own level**
  first, then the escalation subset. Two independent gates, like the menu
  (ADR-0059 §1) — a level is not something a role can be given.
- `RoleController` serves `audience` and accepts it on write; only a `kangaru`
  actor may set it, the same rule `requires_mfa` already carries
  (`UpdateRoleRequest.php:87-92`, ADR-0061 §5).
- `RolesPage`: an audience column, and a filter. No new copy on the screen
  beyond the label itself (`screen-rules.md` §9).

**Exit:** a fleet owner's picker offers no client role and no Kangaru role,
proved by test at all three levels; `GET /roles` still 200s for a
`corporate_admin` reading the catalogue.

### R2 · Roles that can actually run a fleet

**Must not merge before S0.**

- `fleet_owner` gains `STAFF_VIEW` + `STAFF_MANAGE`. It is the role ADR-0059 §5
  guarantees every fleet has, and it is the account support acts as.
- Kangaru composes the rest itself through the Roles screen — that is what R1
  makes possible and what ADR-0004 §"The escalation rule" describes as *"the
  remedy is the feature itself"*. Seed no more system roles than necessary.
- `RolePermissionParityTest` asserts the seeded sets endpoint by endpoint;
  it changes with this, deliberately and visibly.
- **Live needs `RoleSeeder` rerun after deploy** — deploys never reseed, and a
  permission added to the enum but not to the live `roles` rows 403s. It is
  idempotent (`updateOrCreate` on slug).

**Exit:** Najjemba's owner adds a colleague to their own fleet and cannot see,
name or reach Shanitah's.

### U1 · Head office adds head office

- `UserAdminService::insert()` accepts a `kangaru` actor: no fleet, no client,
  `access_level` **assigned explicitly in code** — never from the payload
  (`User::$fillable` deliberately excludes it, and ADR-0055 §4 is the reason).
- `UserPolicy` unchanged from S0: a `kangaru` actor administers `kangaru`
  accounts only.
- The console command stays. It is the way in when there is no way in.
- Delete the stale "that path arrives with S1" comment; replace it with what
  is now true.

**Exit:** `rio@armgenius.com` adds a second head-office colleague from the
Kangaru staff screen; the same call from a fleet actor is refused.

### U2 · Invitation or password, the administrator's choice

Per the owner's decision. Both paths, one endpoint.

- `POST /users` gains a mode. Invitation → account created with a discarded
  random password, `InvitationService::invite()` sends the link, exactly as
  `ClientOnboardingService::firstAdministrator()` and `OperatorService` already
  do. Password → today's behaviour, `PasswordPolicy::rule()` unchanged.
- `StoreUserRequest`'s docblock at `:14-23` is now false — it says the invite
  flow does not exist. Delete it, do not amend it.
- **Mail is the constraint, and it is not this plan's to flip.** `mail.enabled`
  is off on live; Titan SMTP is proven and a real message was sent from the
  container. Until that switch is on, the invitation half is inert and the
  screen must say so rather than appearing to send. The password half works
  regardless, which is precisely why the owner asked for both.

**Exit:** both paths create a working account; with mail off, the invitation
option is visibly unavailable rather than silently failing.

### W1 · The screens

**Load `screen` (which pulls in `quality-control`, `DESIGN.md` and
`docs/screen-rules.md`) and then `emil-design-eng` before writing any
component.** The owner's standing instruction of 22 August, and this plan does
not exempt anything from it.

Reuse, do not invent. `StaffPage.tsx` is the pattern for all three levels —
one dual-purpose dialog, `meta.assignable_roles` from the server, banner and
per-field errors together, `Suspend` as an inline row action.

- **Fleet:** ~~the "Accounts" card on `FleetRecordPage.tsx:187` already lists a
  fleet's people for act-as. Give it the toolbar and row actions it lacks.~~

  **Struck, and not built.** ADR-0065 was written after this plan and forbids
  it: head office administers head office, and `FleetRecordPage` is a Kangaru
  screen. The endpoint would refuse every press, so the button would be a trap
  — the thing `StaffPage` already avoids by rendering "You" and no buttons on
  your own row. The route in is the **Log in as** button that card already
  carries.

  A fleet's own people are managed on the fleet's own `/staff`, which needed no
  new screen — only `fleet_owner` gaining `staff.*` (R2) and a menu entry that
  offers the door. Recorded rather than quietly resolved, per the rule that the
  rules outrank the plan.
- **Client:** append a `Staff` card to `pages/companies/OrganisationView.tsx`,
  the client's own view of itself. **Not** to `CorporateClientsPage` — ADR-0062
  keeps head office out of a client's people, and the route in is act-as.
- **Kangaru:** `StaffPage` at `/staff`, which the menu already offers.
- The role `<Select>` shows only what the server sent; a role the actor may not
  grant is not rendered disabled with a hint, it is absent — the server already
  filters, and the screen keeps no copy of the rule.

**Exit:** driven in a browser at all three levels, screenshots in the report,
and the failure path triggered rather than read.

### Ship-with, not after

Per AGENTS.md's Definition of Done and `screen-rules.md` §7:

- `docs/api/openapi.yaml` — CI fails on drift.
- `RoutePolicyCensusTest`: a row per new route **and its four hand-edited
  counts** (240 routes, 20 public, 220 guarded, 3 idiom-B).
- Module READMEs: `Modules/Administration/README.md` §"Per-tenant roles —
  deferred" is answered by R1 and must stop saying deferred.
- The ADR below.

---

## 4 · The alternatives that lost

**Per-organisation roles** — `roles.operator_id` / `roles.tenant_id`, each
fleet owning private roles. Genuinely more flexible and the owner considered
it. Rejected for now because it reverses ADR-0004's *"custom roles are
platform-wide and Super Admin only… one curated catalogue every tenant picks
from"*, needs a hand-written `Role::scopeForActor` (the model must not take
`BelongsToTenant` — a global scope there hides every role from every user and
breaks authorization platform-wide), and answers a question no fleet has asked.
The audience tag delivers what was actually requested. Revisit if a fleet asks
for a role only it can see.

**Invitation only.** Cleaner, and it removes the "create an account, set its
password, sign in as it" route that ADR-0004 §"The escalation rule" names as
the reason the subset rule exists at all. Rejected by the owner in favour of
both, and the reason is sound: `mail.enabled` is off, so invitation-only would
mean nobody can be added at all.

**Ship the security fix alone first.** Recommended when the forks were put to
the owner; they chose one release. Recorded because if S0 slips, R2 must slip
with it — that coupling is the whole of §2's G4.

**A fleet-side mirror of `ClientCapability`.** A parallel enum of switches for
fleet staff. Rejected: audience-tagged roles express the same thing through the
catalogue that already exists, and a second switch mechanism is a second place
to ask who may do what.

---

## 5 · What this amends

**ADR-0006** said *"a user with no tenant is platform-level and administers
everyone"*, and `UserPolicy` line 106 implemented it literally. That was
written when platform-level meant Shanitah and Shanitah was the platform.
ADR-0055 split the axes and made "platform-level" mean *a fleet*; the policy
was not moved with it. S0 moves it.

**ADR-0004** said custom roles are platform-wide, and they remain so. The
audience tag does not divide the catalogue by owner — it records who a role was
composed for, which is a property of the role, not a scope on it. Stated
explicitly because the two are easy to conflate and the second is the thing
ADR-0004 refused.

**An ADR is required** and should be written with S0, not after it: the change
to who may administer whom is exactly the kind of decision that must be legible
a year from now. Suggested: *ADR-0065 — a fleet administers its own people*.
