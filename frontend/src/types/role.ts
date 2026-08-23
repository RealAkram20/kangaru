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
  /**
   * Whether holders of this role are asked for a second factor (ADR-0061).
   *
   * The per-role half of a two-part rule; the platform-wide half is
   * `auth.mfa_enforced` in System settings, and the two resolve together
   * server-side. Writable by Kangaru head office only.
   */
  requires_mfa: boolean
  /**
   * Holders who have not set a factor up. Turning `requires_mfa` on asks
   * exactly these people to enrol at their next sign-in, so the console says
   * the number before saving. Listing only.
   */
  unenrolled_count?: number
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
  /** ADR-0061: whether the platform is asking for a second factor at all. */
  mfa_enforced: boolean
  /**
   * Whether this actor may change the per-role half. Head office only —
   * a control that weakens authentication must not be reachable by the
   * account it would weaken (ADR-0061 §5). Read from the server rather than
   * re-derived here, so the console holds no copy of the rule.
   */
  can_manage_mfa: boolean
}
