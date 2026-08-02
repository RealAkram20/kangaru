/**
 * The role catalogue as `/api/v1/roles` serves it (ADR-0004).
 *
 * Distinct from `types/staff.ts`'s `AssignableRole`, which is the narrower
 * `{ value, label }` the staff picker needs. Same rows underneath; this is
 * the shape you get when the question is "what does this role grant?"
 * rather than "which may I hand out?".
 */

/** Mirrors `Modules\Administration\Resources\RoleResource`. */
export interface Role {
  /** The external reference: what `users.role` stores. */
  slug: string
  name: string
  description: string | null
  /** Seeded from PROJECT.md's ten. Editable, never deletable or renameable. */
  is_system: boolean
  /** Values from `App\Enums\Permission`. */
  permissions: string[]
  /** Present on the listing only — it is what decides deletability. */
  users_count?: number
  created_at: string
}

/** One entry of `App\Enums\Permission`, as `meta.catalogue` carries it. */
export interface PermissionOption {
  value: string
  label: string
}

/**
 * The catalogue keyed by `Permission::group()` — "Administration",
 * "Billing", "Fleet"… Grouping is derived server-side from the permission
 * value, so a new permission arrives already filed under a heading and this
 * client never holds a list of what exists.
 */
export type PermissionCatalogue = Record<string, PermissionOption[]>

export interface RolesMeta {
  catalogue: PermissionCatalogue
  /**
   * The permissions the caller holds themselves, and therefore the only
   * ones they may put into a role — ADR-0004's escalation rule, evaluated
   * server-side and sent rather than recomputed here.
   */
  grantable: string[]
  /** Whether the caller may write, as opposed to only read the catalogue. */
  can_manage: boolean
}
