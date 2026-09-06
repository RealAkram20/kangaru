/** Mirrors App\Enums\UserStatus. */
export type UserStatus = 'active' | 'suspended'

/**
 * A staff account as the administration endpoints serve it.
 *
 * Distinct from `types/auth.ts`'s `User`, which is what /auth/me returns
 * about *you*. Same underlying resource today, but they answer different
 * questions and the signed-in user has no business gaining fields because
 * a staff list needed them.
 */
export interface StaffUser {
  id: number
  tenant_id: number | null
  name: string
  email: string
  /** The work number a booking raised for this person is dispatched against. */
  phone: string | null
  role: string
  role_label: string
  /**
   * The switches a client's administrator set on this person, unioned onto
   * the role's permissions server-side (App\Enums\ClientCapability). Slugs;
   * the labels arrive in `StaffMeta.capabilities`.
   */
  capabilities: ClientCapability[]
  /** A booking this person creates is approved on their behalf. */
  books_without_approval: boolean
  /**
   * The routes this person rides (ADR-0045 §8). A roster, never a
   * permission — nothing authorises off it. Absent, not empty, where the
   * API did not load the relation (a nested actor on a booking or an audit
   * row), which is why it is optional here.
   */
  route_ids?: number[]
  status: UserStatus
  status_label: string
  is_active: boolean
  deactivated_at: string | null
  created_at: string
}

/**
 * The roles this administrator may assign, served alongside the list.
 *
 * Held server-side so the client keeps no copy of the escalation rule — a
 * Corporate Admin is simply never sent Super Admin, rather than the client
 * being trusted to hide it.
 */
export interface AssignableRole {
  value: string
  label: string
}

/** Mirrors App\Enums\ClientCapability. */
export type ClientCapability =
  | 'approves_bookings'
  | 'sees_finance'
  | 'manages_staff'
  // ADR-0045 §9. Added to the enum with the routes; this list had not
  // caught up, so somebody who builds routes carried a slug the client
  // did not know about.
  | 'manages_routes'

/** One switch, with the words the server uses for it. */
export interface CapabilityOption {
  slug: ClientCapability
  label: string
  description: string
}

/** One of the client's routes, as the staff screen offers it. */
export interface RouteOption {
  id: number
  name: string
}

/**
 * A colleague as the booking dialog's passenger picker gets them, from
 * `GET /colleagues`. Three fields on purpose: naming a passenger is not
 * reading the staff directory, so the endpoint that answers a picker does
 * not serve roles, capabilities or MFA state.
 */
export interface Colleague {
  id: number
  name: string
  phone: string | null
}

export interface StaffMeta {
  assignable_roles: AssignableRole[]
  /**
   * Whether an invitation can actually be delivered — i.e. whether mail is
   * switched on and configured.
   *
   * The choice between emailing a link and setting an initial password is
   * offered only when the platform can keep it. An Invite option that
   * silently created an account nobody could sign into is the hole the
   * invitations table was built to close, reopened from the other end.
   */
  can_invite?: boolean
  /**
   * The client's active routes this administrator may put somebody on.
   * Served with the list so the screen keeps no copy — empty for a platform
   * account, which belongs to no client and so has no routes.
   */
  routes?: RouteOption[]
  /**
   * The switches this administrator may set on their people, served so the
   * page keeps no copy of the list or the labels. Empty for an API older
   * than the feature.
   */
  capabilities?: CapabilityOption[]
}
