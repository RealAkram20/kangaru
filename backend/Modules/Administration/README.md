# Administration

## Purpose

Platform administration: authentication and (later) user, role, and
permission management.

## Responsibilities

- Login, logout, and "who am I" (`/auth/login`, `/auth/logout`, `/auth/me`)
  via Sanctum bearer tokens.
- Future: user management CRUD, role/permission assignment, MFA for Super
  Admin and Finance roles (PROJECT.md), platform-level audit log access.

## Dependencies

- `App\Models\User` — the framework-anchored model this module's auth
  actions operate on (kept in `app/`, not `Modules/`, since Sanctum,
  `config/auth.php`, and the default `UserFactory` all assume it lives
  there by convention).
- `App\Support\Api\ApiResponse`, `App\Enums\ErrorCode` — response envelope.

## Public APIs

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | none | Rate limited 5/min/IP |
| POST | `/api/v1/auth/logout` | Sanctum | Revokes the current access token |
| GET | `/api/v1/auth/me` | Sanctum | Returns the authenticated user |

## Notes

No `UserPolicy` yet — `login`/`logout`/`me` act on the caller's own
identity, not a policy-guarded resource belonging to someone else, so
AGENTS.md's "every endpoint has a Policy" doesn't cleanly apply to these
three routes. A real `UserPolicy` is needed once this module gets actual
user-management CRUD (creating/editing other users).

MFA (required for Super Admin and Finance per PROJECT.md) is not
implemented yet — out of scope for the Phase 1 scaffolding pass.
