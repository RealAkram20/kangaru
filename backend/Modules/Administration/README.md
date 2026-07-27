# Administration

## Purpose

Platform administration: authentication, the audit log, and (later) user,
role, and permission management.

## Responsibilities

- Login, logout, and "who am I" (`/auth/login`, `/auth/logout`, `/auth/me`)
  via Sanctum bearer tokens.
- Audit log query API (`/audit-logs`) — tenant admins can browse their own
  tenant's append-only audit trail (AGENTS.md Observability requirement,
  required before the first bank demo). The audit *infrastructure* itself
  (`App\Models\AuditLog`, `App\Concerns\Auditable`) lives in `app/` as
  cross-cutting platform infra, same as `Tenant`/`TenantContext` — this
  module only owns the query surface (Controller/Policy/Resource/Routes).
- Future: user management CRUD, role/permission assignment, MFA for Super
  Admin and Finance roles (PROJECT.md).

## Dependencies

- `App\Models\User` — the framework-anchored model this module's auth
  actions operate on (kept in `app/`, not `Modules/`, since Sanctum,
  `config/auth.php`, and the default `UserFactory` all assume it lives
  there by convention).
- `App\Models\AuditLog`, `App\Concerns\Auditable`, `App\Exceptions\AuditLogImmutableException`
  — the audit infrastructure this module's `/audit-logs` endpoint queries.
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode` — response envelope.

## Public APIs

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | none | Rate limited 5/min/IP |
| POST | `/api/v1/auth/logout` | Sanctum | Revokes the current access token |
| GET | `/api/v1/auth/me` | Sanctum | Returns the authenticated user |
| GET | `/api/v1/audit-logs` | Sanctum + tenant | `AuditLogPolicy::viewAny` — Corporate Admin or Super Admin only. Optional whitelisted filters `auditable_type` (`company`\|`user`), `action` (`created`\|`updated`\|`deleted`); unknown query params → 422. Cursor-paginated (`meta.cursor.next`). |

## Notes

No `UserPolicy` yet — `login`/`logout`/`me` act on the caller's own
identity, not a policy-guarded resource belonging to someone else, so
AGENTS.md's "every endpoint has a Policy" doesn't cleanly apply to these
three routes. A real `UserPolicy` is needed once this module gets actual
user-management CRUD (creating/editing other users).

MFA (required for Super Admin and Finance per PROJECT.md) is not
implemented yet — out of scope for the Phase 1 scaffolding pass.

`Auditable` is applied to `Company` (credit limits) and `User`
(roles/permissions) today — the only two named mutation types in
AGENTS.md with real models. Rate cards, contracts, invoices, and payments
need the same trait applied once the Billing module exists; don't forget
this when that module ships.
