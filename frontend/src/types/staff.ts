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
  role: string
  role_label: string
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

export interface StaffMeta {
  assignable_roles: AssignableRole[]
}
