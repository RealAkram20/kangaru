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
| POST | `/api/v1/auth/login` | none | Rate limited 5/min/IP |
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
| GET | `/api/v1/audit-logs` | Sanctum + tenant | `AuditLogPolicy::viewAny` — `audit.view`. Whitelisted filters: `auditable_type` (any alias in the enforced morph map), `action`, `user_id`, `from`/`to` (`Y-m-d`; `to` includes its whole day). Unknown params → 422. Cursor-paginated. `meta.filters` carries the accepted values plus the actors present in this reader's slice; `meta.scope` is `platform` or `tenant` |

## Notes

**Tenant scoping on `/users` is manual and must stay that way.** `User`
deliberately has no `BelongsToTenant`: login must find an account by email
before any tenant is known, and Super Admins have no tenant at all. Nothing
scopes those queries automatically, so a forgotten `where` leaks names,
emails and roles across tenants. It is applied in `UserController::scopedQuery()`
and asserted by `UserAdminTest` — note that this module's isolation cases
live in that file rather than in a `*CrossTenantIsolationTest` of their own,
unlike every other module's.

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

- **MFA for Super Admin and Finance.** AGENTS.md marks it required in
  Phase 1 for the two roles that can move money and change rates. Not
  built. This is the largest known gap in this module.
- **Resetting somebody else's password.** Deliberate, not an oversight: an
  administrator silently changing another account's password is the one act
  an audit trail cannot tell apart from impersonation. There is no
  endpoint, and adding one needs a decision about how it is evidenced —
  e.g. a forced reset on next login rather than a chosen password.
- **Audit log: no export and no free-text search.** The reader
  (`frontend/src/pages/AuditLogPage.tsx`) filters by record type, action,
  actor and date range, shows before/after diffs and pages by cursor — so
  "every credit-limit change in March" is answerable. What it still has
  not got: any way to **export** (a bank will ask for the PDF or the
  spreadsheet, and `Modules/Reports`' export machinery is not wired to
  this endpoint), free-text search across the diff itself, and filtering
  to a single record — you can ask for every Company change but not for
  Company #3's history.
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
