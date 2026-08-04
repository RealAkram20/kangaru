# Administration

## Purpose

Platform administration: authentication, staff accounts, the role and
permission catalogue, and the audit log.

## Responsibilities

- Login, logout, and "who am I" (`/auth/login`, `/auth/logout`, `/auth/me`)
  via Sanctum bearer tokens.
- **Changing your own password** (`PATCH /auth/password`) — and only your
  own; there is no user parameter for an administrator to supply. Every
  token is revoked afterwards, this one included.
- **Staff administration** (`/users`) — onboarding a colleague, changing a
  role, suspending and restoring an account. No `DELETE`: accounts are
  suspended, never removed, because a user who raised a booking or issued
  an invoice is referenced by rows that must outlive them (and
  `invoices.issued_by_user_id` is `restrictOnDelete`, so the database
  refuses it anyway). Suspending revokes the account's Sanctum tokens, so
  it reaches sessions that are already signed in.
- **The role catalogue** (`/roles`) — ADR-0004. `App\Enums\Permission` is
  the catalogue of abilities and lives in code; roles are rows carrying a
  JSON permission set. The ten Phase 1 roles are seeded as **system
  roles**: editable, never deletable or renameable, because `users.role`
  values, seeders and every existing test refer to them by slug.
- Audit log query API (`/audit-logs`) — tenant admins can browse their own
  tenant's append-only audit trail (AGENTS.md Observability requirement,
  required before the first bank demo). The audit *infrastructure* itself
  (`App\Models\AuditLog`, `App\Concerns\Auditable`) lives in `app/` as
  cross-cutting platform infra, same as `Tenant`/`TenantContext` — this
  module only owns the query surface (Controller/Policy/Resource/Routes).

## Dependencies

- `App\Models\User` — the framework-anchored model this module's auth
  actions operate on (kept in `app/`, not `Modules/`, since Sanctum,
  `config/auth.php`, and the default `UserFactory` all assume it lives
  there by convention).
- `App\Enums\Permission` — the ability catalogue every policy in every
  module checks against. Owned here in spirit, but kept in `app/` because
  Billing, Dispatch, Trips and Reports policies all depend on it.
- `App\Models\AuditLog`, `App\Concerns\Auditable`, `App\Exceptions\AuditLogImmutableException`
  — the audit infrastructure this module's `/audit-logs` endpoint queries.
  `Role` is `Auditable`, since AGENTS.md requires a trail over
  "roles/permissions" and this is now literally where those live.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode` — response envelope.

## Public APIs

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | none | Rate limited 5/min/IP. **`202` with a `challenge_id` and no token** for **any** user holding a confirmed factor (ADR-0010 — the factor, not the role); `200` with a token otherwise, carrying `must_enrol_mfa` |
| POST | `/api/v1/auth/mfa/verify` | none | Rate limited 10/min/IP. Exchanges `challenge_id` + `code` for a token. Accepts a TOTP code or a recovery code |
| POST | `/api/v1/auth/mfa/enrol` | Sanctum | Starts enrolment: `secret`, `otpauth_uri`, `qr_svg`. `409 MFA_ALREADY_ENROLLED` if a factor is already confirmed |
| POST | `/api/v1/auth/mfa/enrol/confirm` | Sanctum | Proves a code and returns the ten recovery codes — **the only time they are legible** |
| POST | `/api/v1/auth/mfa/recovery-codes` | Sanctum | Regenerates the set, invalidating the old one. Own account only |
| DELETE | `/api/v1/auth/mfa` | Sanctum | Rate limited 10/min/IP. Removes your own factor against a current TOTP **or recovery** code (ADR-0010). `403` if your role requires one |
| POST | `/api/v1/auth/logout` | Sanctum | Revokes the current access token |
| GET | `/api/v1/auth/me` | Sanctum | Returns the authenticated user |
| PATCH | `/api/v1/auth/password` | Sanctum | Own password only. Rate limited 5/min. Revokes every token, including the caller's |
| GET | `/api/v1/users` | Sanctum + tenant | `UserPolicy::viewAny`. Whitelisted filters `status`, `role`, `q`; unknown params → 422. `meta.assignable_roles` carries the roles this actor may hand out |
| POST | `/api/v1/users` | Sanctum + tenant | `UserPolicy::create`. Administrator sets the initial password |
| GET | `/api/v1/users/{user}` | Sanctum + tenant | `UserPolicy::view` |
| PATCH | `/api/v1/users/{user}` | Sanctum + tenant | `UserPolicy::update`. Name, email, role, status. Suspension revokes tokens |
| GET | `/api/v1/roles` | Sanctum + tenant | `RolePolicy::viewAny` — `roles.manage` **or** `staff.view`, since whoever assigns a role must be able to read it. `meta.catalogue` (grouped permissions), `meta.grantable` (what this actor may put in a role), `meta.can_manage` |
| POST | `/api/v1/roles` | Sanctum + tenant | `RolePolicy::create` — `roles.manage`. Slug derived from the name when omitted |
| PATCH | `/api/v1/roles/{slug}` | Sanctum + tenant | `RolePolicy::update`. A system role's permissions may change; its name may not |
| DELETE | `/api/v1/roles/{slug}` | Sanctum + tenant | `RolePolicy::delete` — custom roles only, and 409 `ROLE_IN_USE` while anyone holds it |
| GET | `/api/v1/audit-logs` | Sanctum + tenant | `AuditLogPolicy::viewAny` — `audit.view`. Whitelisted filters: `auditable_type` (any alias in the enforced morph map), `auditable_id` (requires `auditable_type`), `action`, `user_id`, `q` (free text, incl. the recorded diff), `from`/`to` (`Y-m-d`; `to` includes its whole day). Unknown params → 422. Cursor-paginated. `meta.filters` carries the accepted values plus the actors present in this reader's slice; `meta.scope` is `platform` or `tenant` |

## Frontend

`frontend/src/pages/SettingsPage.tsx` — `/settings`. Your own account:
password, and the second factor if you have one.

It exists because three endpoints had no caller. `PATCH /auth/password`
shipped with staff administration and nothing ever called it, so an
administrator could hand somebody an initial password and that person had
no way to take it out of the administrator's hands — half a feature, and
the wrong half. ADR-0008 added two more orphans on top: regenerating
recovery codes, and knowing whether a factor is even on.

Only ever the signed-in user. No user parameter for an administrator to
supply, for the same reason this module offers no password reset for
anyone else.

**The route is registered and there is no navigation entry for it.** It is
reachable by typing `/settings`. Adding the sidebar row means editing
`SidebarNav.tsx` and `AppShell.tsx`, which were uncommitted work in
progress when this shipped.

Two things the page states rather than hides:

- Changing a password revokes **every** token including the caller's, so
  the form is replaced by a sign-out rather than left looking usable. The
  next request would otherwise 401 and bounce to `/login` with no
  explanation.
- A role that does not require a factor still gets **no "turn it on"
  button**, but the reason has changed. It used to be that enrolling
  produced an authenticator nothing ever asked for; since ADR-0010 login
  honours the factor rather than the role, so voluntary enrolment works
  end to end and `DELETE /auth/mfa` turns it back off. What is missing is
  only the screen — the ADR puts the UI out of scope the way ADR-0006 and
  ADR-0009 did, so the capability is reachable by API and not yet offered
  on the page.

## Notes

**Tenant scoping on `/users` is manual and must stay that way.** `User`
deliberately has no `BelongsToTenant`: login must find an account by email
before any tenant is known, and Super Admins have no tenant at all. Nothing
scopes those queries automatically, so a forgotten `where` leaks names,
emails and roles across tenants. Since ADR-0006 it is expressed as
`User::scopeForActor` — the same name every other cross-tenant read uses —
which for this model has to add the `where` for a tenant actor rather than
drop a scope for a platform one, because there is no scope to drop. Applied
in `UserController::scopedQuery()` and asserted by `UserAdminTest`; note
that this module's isolation cases live in that file rather than in a
`*CrossTenantIsolationTest` of their own, unlike every other module's.

**Three of ADR-0006's five hand-rolled bypasses were in this module** —
`UserController::scopedQuery()`, `UserAdminService::create()` and
`UserPolicy::sharesTenant()` — each writing `tenant_id === null` out by
hand. They now say `isPlatformLevel()` and `forActor()`. Behaviour is
unchanged by design; the point is that the sixth copy cannot be written
differently.

**Creating a tenant-less account is a serious act.** `UserAdminService`
lets a platform-level actor pass `tenant_id: null`, which since ADR-0006
mints Shanitah staff who read across every client. `staff.manage` is the
gate and ADR-0004's escalation rule is what keeps a Corporate Admin away
from it — a tenant administrator's new colleagues are always their own
tenant's, whatever the request body says.

**The audit log's platform reader now has a name.** `AuditLog::forActor()`
replaces the hand-rolled `allTenants()` branch, and `meta.scope` still
reports `platform` or `tenant` so the UI can say which trail is on screen.
This is what makes role changes readable at all: role rows carry a null
`tenant_id` because the catalogue is platform-wide (ADR-0004), so no
tenant-scoped reader would ever show them.

**`?q=` searches the recorded diff, and that is the point.** The other
filters ask *which record* and *who*; the question a bank actually opens
with is *which field* — "who touched the credit limit" — and the field
that changed lives inside `changes`, not in a column. So the search
matches `auditable_type`, `action`, the actor's name, and the `changes`
JSON as text.

Matching JSON as text is blunt and deliberately so: it matches field
names and values alike, and a search for `updated` also finds creation
rows, because a creation snapshot is the whole record and carries an
`updated_at` key. `?action=updated` remains the exact question, and the
search is the broad one. The alternative — a generated column per audited
field — cannot exist for a diff whose shape is every model in the system.
`AuditLogSearchTest` covers the field-name case, the actor case, the
escaped-wildcard case (`%` is text, not a pattern), and that the search
narrows a filtered set rather than widening it: the ORs are wrapped in
their own closure, and flattening them was verified to turn that test
red.

**`?auditable_id=` needs `auditable_type` beside it**, and the refusal is
correctness rather than fussiness. Ids are per-table, so a bare
`auditable_id=3` would return Company 3, Vehicle 3 and User 3 interleaved
and present it as one record's history — a wrong answer that looks like a
right one. `AuditLogSearchTest` builds a vehicle sharing a company's id
to assert the pair does not mix them.

**A client sees us in their own log.** A platform dispatcher acting on a
client's trip is recorded against *that client's* tenant (ADR-0006
Decision 5), because `AuditLog::record()` sources `tenant_id` from the
audited model rather than from the actor. Asserted from the client's side
in `PlatformTenantBindingTest` — read through the tenant-scoped reader the
client actually uses, not through `allTenants()`.

**Roles are deliberately not tenant-scoped.** There is one platform-wide
catalogue and every tenant picks from it, which is what keeps the
escalation surface a single role wide. A global scope on `Role` would hide
every role from every tenant user and break authorization platform-wide.

**The escalation rule** (ADR-0004): nobody may grant a permission they do
not themselves hold. Enforced twice — when a role is *defined*
(`StoreRoleRequest`/`UpdateRoleRequest`) and when it is *assigned*
(`UserPolicy::assignRole`) — because an administrator who sets the new
account's password could otherwise sign in as it.

## What's explicitly deferred

Named here so a half-built thing is not mistaken for a finished one.

- **~~MFA for Super Admin and Finance~~ — built, ADR-0008 (3 August 2026).**
  Kept in place because the *shape* of what remains deferred is easier to
  read against what it replaced. This was the oldest unmet stated
  requirement in the repository; it is now met, and the answer to a bank's
  "is MFA enforced for privileged users?" is yes.

  What shipped: TOTP (`spomky-labs/otphp`), a two-step login that issues
  **no token at all** before the factor is proved, forced enrolment with no
  grace period, ten single-use hashed recovery codes, an app-encrypted
  secret, and a 24-hour Sanctum expiry with a scheduled prune.

  **~~Voluntary MFA is reachable and pointless~~ — decided and built,
  ADR-0010 (3 August 2026).** `AuthService::login` challenged on
  `requiresMfa() && hasMfaEnabled()`, so a user in an unprivileged role
  could enrol, read `mfa_enabled: true` off their own account and never
  once be asked for a code. It now challenges on the **factor**;
  `requiresMfa()` still decides who *must* enrol, through
  `mustEnrolInMfa()` and `EnsureMfaEnrolled`, and no longer decides who
  gets asked.

  ADR-0010 also answers the trap that follows from it: honouring a
  voluntary factor with no way to remove one would leave every opt-in
  account a lost phone away from being unrecoverable, since ADR-0008
  builds no administrator reset on purpose. So `DELETE /auth/mfa` removes
  a factor against a current code — TOTP or recovery — for a role that
  does not require one, and `403`s for a role that does.

  **~~`RECOVERY_CODE_LOW_WATER_MARK` is read by nothing~~ — built,
  ADR-0010.** `MfaService::recoveryCodesAreLow()` is its reader, and
  `UserResource` carries `mfa_recovery_codes_remaining` and
  `mfa_recovery_codes_low`. The verdict is the service's, not a
  comparison written in a resource or a screen, so "low" cannot come to
  mean two numbers in two places. Codes are still never regenerated
  automatically — replacing a set silently invalidates the printed sheet
  its holder is relying on.

  Still deferred inside it, per the ADR's own Scope: WebAuthn/passkeys,
  trusted devices ("remember this browser"), step-up authentication for
  individual dangerous acts, and admin-initiated MFA reset — which is the
  same hazard as the password item below and has the same answer.

  Two things worth knowing operationally:

  - **`roles.requires_mfa` is a per-role flag**, not two hardcoded slugs.
    Seeded true for `super_admin` and `finance` and nothing else, but a
    custom role holding `invoices.manage` moves money exactly as Finance
    does and can be covered without a release.
  - **The demo accounts share a fixed, documented TOTP secret**
    (`DatabaseSeeder::DEMO_TOTP_SECRET`), and the seeder **throws** rather
    than skipping if asked to write it outside `local`/`testing`/`staging`.
    A bypass flag was rejected for the opposite reason: it would fail
    silently in production, and a control that quietly stops asking is
    worse than one that refuses to install.
- **Resetting somebody else's password.** Deliberate, not an oversight: an
  administrator silently changing another account's password is the one act
  an audit trail cannot tell apart from impersonation. There is no
  endpoint, and adding one needs a decision about how it is evidenced —
  e.g. a forced reset on next login rather than a chosen password.
- **Audit log: no export.** The reader
  (`frontend/src/pages/AuditLogPage.tsx`) now filters by record type,
  record id, action, actor, date range and free text, shows before/after
  diffs and pages by cursor. What it still has not got is any way to
  **export**: a bank will ask for the PDF or the spreadsheet, and
  `Modules/Reports`' export machinery is not wired to this endpoint.
- **`meta.filters.actors` runs a `DISTINCT user_id` over the reader's
  slice on every request.** Fine at Phase 1 volumes and indexed, but it is
  an unbounded scan on a table PROJECT.md expects to grow indefinitely.
  Worth caching or bounding before the trail gets large.
- **Role audit rows are invisible to a tenant reader**, and this is
  correct but worth stating: they carry a **null `tenant_id`** because the
  catalogue is platform-wide, so `TenantScope` hides them. A Corporate
  Admin's audit log will never show a role change. Only a platform reader
  (`tenant_id` null) sees them, which is why the endpoint reports
  `meta.scope`. Widening that is part of the platform-staff decision below.
- **Platform staff.** ADR-0005 decided Shanitah's dispatchers, Finance, HR
  and Operations are platform-level, but a user with `tenant_id` null gets
  `TenantScope`'s fail-closed default and would see no bookings and no
  trips at all. Until that has its own ADR they stay seeded inside client
  tenants. `/users` is already keyed off `tenant_id` rather than a role
  name, so it is ready for them; nothing else is.
- **Permission-aware navigation.** ADR-0004 noted that the frontend's copy
  of who-sees-what (`frontend/src/lib/navigation.ts`) should be served from
  the API once roles are data. It still is not. The consequence is
  concrete: a **custom** role holding `roles.manage` gets no Roles entry in
  the sidebar, because that map keys off the ten built-in slugs. The
  `/roles` route itself is deliberately not behind `RequireNavAccess` for
  exactly this reason, so such a holder reaches the page by URL and the
  server serves them — but the menu will not offer it.
- **Per-tenant roles.** Custom roles are platform-wide and Super Admin
  only, by decision. A tenant cannot compose a permission set for itself.
- **Bulk staff operations** — no CSV import, no bulk suspend. Onboarding is
  one account at a time.
