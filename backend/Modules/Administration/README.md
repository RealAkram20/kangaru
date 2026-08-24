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
- **The colleague lookup** (`/colleagues`) — the passenger picker behind the
  booking dialog. A client's booking is for a client's own person, and a
  bank branch network is thousands of accounts, so the passenger field is a
  server-side search rather than a dropdown holding the directory. Three
  fields come back — id, name, work number — and the number is the one
  collected on the account (`users.phone`), so a driver is dispatched
  against something checked once instead of retyped from memory. The
  enforcement is `StoreBookingRequest`: a tenant actor who names nobody gets
  a 422, and the passenger's *name* is then taken off the account rather
  than out of the payload, so one employee cannot arrive spelled three ways.
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
| GET | `/api/v1/support/act-as` | Sanctum | Whether this request is being made by somebody acting as the account, and until when. **`null` for everybody who is simply themselves**, which is almost every request. A route of its own rather than a field on `UserResource`, because the session is a fact about the *request* — and a field there would append `acting_as: null` to every nested actor in the API |
| POST | `/api/v1/support/act-as` | Sanctum | Begins a support session (ADR-0056). `support.act-as` **and** `access_level = kangaru`; a reason is required and recorded. Rate limited 10/min. Refuses chaining, a second open session, and acting as yourself |
| DELETE | `/api/v1/support/act-as` | Sanctum | Ends it. **Idempotent, and deliberately unguarded** — stopping is the one act a support agent must always be able to perform, and a guard here would strand them inside somebody else's account until the thirty minutes ran out |
| GET | `/api/v1/auth/me` | Sanctum | Returns the authenticated user. `UserResource` carries `tenant_name` (additive) — the client's own name for the console's chrome, null for platform staff |
| PATCH | `/api/v1/auth/password` | Sanctum | Own password only. Rate limited 5/min. Revokes every token, including the caller's |
| POST | `/api/v1/auth/password/forgot` | none | Rate limited 3/min/IP. ADR-0028 §2: emails a 6-digit code, hashed at rest, 15-min TTL. **Identical 202 whether or not the email exists.** 409 `AUTH_METHOD_DISABLED` until the owner enables it and SMTP is configured |
| POST | `/api/v1/auth/password/reset` | none | Rate limited 5/min/IP. Exchanges the code for a new password; single-use, five wrong guesses burn it; success revokes every token |
| POST | `/api/v1/auth/social` | none | Rate limited 5/min/IP. ADR-0028 §3: verifies a Google/Facebook proof server-side against admin-stored credentials. 200 signed_in (driver-scoped token) · 202 sign_up (verified name+email, **nothing created** — ADR-0027 holds) · 409 `MFA_REQUIRED` · 403 `NOT_A_DRIVER` · 401 `SOCIAL_TOKEN_INVALID` |
| GET | `/api/v1/users` | Sanctum + tenant | `UserPolicy::viewAny`. Whitelisted filters `status`, `role`, `q`; unknown params → 422. `meta.assignable_roles` carries the roles this actor may hand out; `meta.capabilities` the client-capability catalogue (below); `meta.routes` the client's active routes a colleague may be put on (empty for platform staff, who have none) |
| POST | `/api/v1/users` | Sanctum + tenant | `UserPolicy::create`. Administrator sets the initial password. Required `phone`. Optional `capabilities[]`, `books_without_approval`, `route_ids[]` |
| GET | `/api/v1/users/{user}` | Sanctum + tenant | `UserPolicy::view` |
| PATCH | `/api/v1/users/{user}` | Sanctum + tenant | `UserPolicy::update`. Name, email, phone, role, status, `capabilities[]` and `route_ids[]` (each the whole list, replacing), `books_without_approval`. Suspension revokes tokens |
| GET | `/api/v1/colleagues` | Sanctum + tenant | `BookingPolicy::create` — *you may look up a colleague if you may book a car for one.* Required `q` (min 2), at most 15 results, three fields each. Deliberately **not** a filter on `/users`, which is gated on `staff.view` and answers with roles and MFA state that the Corporate Employee naming a passenger does not hold. Empty for platform staff, who belong to no client |
| GET | `/api/v1/roles` | Sanctum + tenant | `RolePolicy::viewAny` — `roles.manage` **or** `staff.view`, since whoever assigns a role must be able to read it. `meta.catalogue` (grouped permissions), `meta.grantable` (what this actor may put in a role), `meta.can_manage` |
| POST | `/api/v1/roles` | Sanctum + tenant | `RolePolicy::create` — `roles.manage`. Slug derived from the name when omitted |
| PATCH | `/api/v1/roles/{slug}` | Sanctum + tenant | `RolePolicy::update`. A system role's permissions may change; its name may not |
| DELETE | `/api/v1/roles/{slug}` | Sanctum + tenant | `RolePolicy::delete` — custom roles only, and 409 `ROLE_IN_USE` while anyone holds it |
| GET | `/api/v1/public/settings` | none | Rate limited 30/min/IP. The branding subset only — what may appear is decided by the catalogue's `public` flags (ADR-0014 §5), never by the controller. Asset paths arrive as absolute URLs |
| GET | `/api/v1/public/legal` | none | Rate limited 30/min/IP. The Terms and Privacy notices the Driver App's sign-up form requires consent to. Unauthenticated of necessity: it is read on the one screen that exists before an account does. Kept off `/public/settings` because the documents are long and that endpoint is fetched on every page load |
| GET | `/api/v1/settings` | Sanctum | `settings.manage`. Every group resolved against catalogue defaults; secrets appear as `{configured: bool}`, never as values |
| PATCH | `/api/v1/settings/{group}` | Sanctum | `settings.manage`. Unknown group or key → 422 rather than a silent skip. Audited with before/after; secrets masked as `***` |
| POST | `/api/v1/settings/assets/{asset}` | Sanctum | `settings.manage`. Multipart logo/favicon upload to the public disk |
| POST | `/api/v1/settings/mail/test` | Sanctum | `settings.manage`. Sends a test message using the stored SMTP credentials; refuses until mail is configured |
| GET | `/api/v1/audit-logs` | Sanctum + tenant | `AuditLogPolicy::viewAny` — `audit.view`. Whitelisted filters: `auditable_type` (any alias in the enforced morph map), `action`, `user_id`, `from`/`to` (`Y-m-d`; `to` includes its whole day). Unknown params → 422. Cursor-paginated. `meta.filters` carries the accepted values plus the actors present in this reader's slice; `meta.scope` is `platform` or `tenant` |

## Client capabilities — a corporate client's own access control

`App\Enums\ClientCapability` (2026-08-19). Roles are platform-wide
(ADR-0004): one catalogue, seeded by Shanitah, read by every client, so a
client cannot own a role. What a client's administrator *can* own is a
person's switches. Each capability is a fixed bundle of existing
permissions that `User::permissions()` unions onto the role's set:

| Slug | Grants | For |
|---|---|---|
| `approves_bookings` | `bookings.approve`, `bookings.view.all`, `trips.view.all` | a branch officer who approves the branch's requests |
| `sees_finance` | `invoices.view`, `reports.view` | a finance clerk who reconciles the month |
| `manages_staff` | `staff.view`, `staff.manage` | a deputy who onboards colleagues |

Stored as slugs on `users.capabilities` (JSON). Every policy keeps asking
`hasPermission()`; nothing new is authorised. Fail-closed on every edge: a
slug the enum does not know grants nothing, a permission outside a bundle
cannot arrive, a user with no role gets no capabilities, and the requests
apply the same escalation rule as roles — nobody grants what they do not
hold (`holdsAll`). Refused on platform accounts (`tenant_id` null): a
capability is a client's switch for a client's person. Changes are on the
audit trail like any user update.

**`users.books_without_approval`** is the one switch that is not a
permission: `BookingService::create()` approves that person's own bookings
on their behalf, the same transition and audit rows as a human approver,
beside the owner's platform-wide `booking.approval_required` waiver.

The console reads `capabilities` off `/auth/me` to widen the client's menu
(`lib/navigation.ts`), and the Staff page offers the switches from
`meta.capabilities` — the labels are served, not copied.

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

**One password floor, in `App\Support\Auth\PasswordPolicy` (24 August 2026).**
Every door on the platform validates against `PasswordPolicy::rule()` — this
module's `StoreUserRequest`, `ChangePasswordRequest`, `PasswordResetController`,
`InvitationController` and `CreateKangaruStaff`, plus `StoreDriverAccountRequest`,
`StoreDriverApplicationRequest` and `RegisterCustomerRequest` in Drivers and
Customers. The floor is **six**, set by the owner for every door at once.

It is written down here because the previous arrangement was not a policy but
an accident, and it had already reached users:

- The number lived in **eight** places and disagreed with itself in three —
  twelve where the office minted an account for somebody else, eight where a
  person chose their own, a plain `min:8` string rule at the customer register,
  and an unconfigured `Password::defaults()` in the console command that meant
  Laravel's own eight by default rather than by decision.
- `ProfilePage` told staff *"At least 12 characters"* for a door that accepted
  eight, and the driver sign-in dialog set a password at twelve while telling
  the office to *"ask them to change it from their own profile afterwards"* —
  a door with a different rule.

**Adding a ninth place fails a test, not a review.**
`tests/Feature/Auth/PasswordFloorTest.php` walks the reachable doors as
boundary tests (one below refused, exactly at it accepted) and then censuses
the source for any `Password::min(` or `Password::defaults(` outside
`PasswordPolicy`. The boundary half cannot catch a door that does not exist
yet; the census is the half that can.

Length is a floor, not the control — there is no complexity requirement at any
door and never was. The strength meter in both apps
(`frontend/src/components/forms/PasswordMeter.tsx`,
`mobile/src/auth/PasswordMeter.tsx`) is what teaches above it.

**A token is now scoped to the app that asked for it (ADR-0022).** `POST
/auth/login` and `POST /auth/mfa/verify` take an optional
`client: console | driver`. Absent means `console`, which holds `*` exactly
as every token did before, so the web app and existing integrations are
untouched. A `driver` token reaches the nineteen route names in
`App\Support\Auth\ClientScope::routesFor()` and answers
`403 TOKEN_SCOPE_EXCEEDED` on everything else.

Three things about it are easy to get wrong later:

- **The list is fail-closed.** Adding a route to this API leaves it *shut*
  to the driver app until somebody names it. If the mobile team reports a
  403 on something they legitimately need, the fix is a line in
  `ClientScope`, not a change to the middleware.
- **The client is self-declared and the code says so.** It is not a defence
  against the person signing in — they may always ask for a console token.
  It bounds what a credential sitting on a lost handset is worth. Do not
  let it be described as more than that.
- **It refuses before the policy check**, so a super admin on the driver app
  gets `TOKEN_SCOPE_EXCEEDED` rather than `INSUFFICIENT_PERMISSIONS`. That
  ordering is what makes the feature testable: a test using a driver-role
  token alone would pass with the whole thing deleted, because the role
  refuses those endpoints anyway. `TokenScopeTest` signs a super admin in on
  the driver app for exactly that reason, and the guard is mutation-checked.

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

## Acting as somebody else (ADR-0056)

Reverses a position this module states twice — `AuthController::changePassword`
calls an admin resetting somebody's password *"the one act an audit trail
cannot tell apart from impersonation"*, and `Modules/Customers/Routes/staff.php`
says *"no impersonation"* outright.

**The objection was never to impersonation. It was to impersonation the trail
cannot distinguish from the person's own hand.** So that is what was built:

- `audit_logs.impersonator_id`. **`user_id` stays the subject**, so a client's
  own trail reads chronologically as their account's activity; the new column
  names who was holding it. Never one without the other when rendered.
- `impersonation_sessions` — the evidence that a session *happened*. Start and
  end are audited in their own right, because reading a bank's trip history is
  the act whether or not anything was written.
- Thirty minutes, enforced as a **predicate, not a cron**. Nothing sweeps the
  table, so a scheduler that stops running cannot leave a session standing.
- `ActAsSubject` middleware swaps the user **before `IdentifyTenant`**. That
  ordering is the whole of its correctness: after it, a session would carry the
  *actor's* fleet — a Kangaru account's, which is none — and every scoped read
  would come back empty while looking like it had worked.
- The deny-list (§3) is **attached to routes, never matched against route
  names**. A name-matching deny-list is one rename away from silently
  permitting what it was written to refuse. It guards the password, MFA, payout
  destinations, account closure and settlement decisions — the acts whose whole
  purpose is to prove it was the person.
- It **never mints a client-app token**. A driver token handed to a support
  agent would let them register a push device and take a real job off a driver
  on the road.

### What keeps the grant narrow

Not the permission catalogue — the **level**. Only a `kangaru` account may act
as anybody, and one can only be created with a shell on the server
(`php artisan kangaru:create-staff`).

Holding `support.act-as` out of the Super Admin catalogue was tried and
reverted the same hour: `StoreRoleRequest` refuses to let anybody author a role
carrying a permission they do not hold themselves, so the exclusion made the
permission **ungrantable by any screen**. Ungrantable is not stricter; it is
broken. A fleet Super Admin holds the permission and cannot use it.

### Not built, and it matters

The **notification to the person acted upon** (§5). Their own audit trail shows
it, and the banner shows the agent — but nobody tells the driver or the client
afterwards. Named here rather than left to be discovered.

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
