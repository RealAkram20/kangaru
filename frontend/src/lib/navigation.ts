import type { User } from '../types/auth'

/**
 * Which navigation entries a role can actually use.
 *
 * **This is convenience, not authorization.** AGENTS.md is explicit that
 * frontend permissions are never relied on alone, and every endpoint behind
 * these entries answers 401/403 on its own regardless of what is rendered.
 * The same stance as `canManageBilling` in lib/billing.ts.
 *
 * What it is for: a menu offering eleven destinations to somebody who can
 * open four is not a shortcut, it is a maze. A Corporate Employee was being
 * shown Dispatch, Rate cards and Reports; three of those answered 403 and
 * one rendered a working dispatch board they had no business operating.
 * Offering a door that opens onto a refusal is worse than not offering it.
 *
 * Each entry below mirrors a specific server-side rule, named so the two
 * can be compared when either moves. If they ever disagree the server wins,
 * and the symptom is a visible menu item that refuses — which is the safe
 * direction for them to disagree in.
 */

/** Mirrors App\Enums\UserRole. */
type Role = string

const ALL: Role[] = [
  'super_admin',
  'operations_manager',
  'dispatcher',
  'finance',
  'fleet_owner',
  'branch_manager',
  'depot_manager',
  'corporate_admin',
  'corporate_employee',
  'driver',
]

/** TripPolicy::DISPATCH_ROLES / BookingPolicy::dispatch. */
const DISPATCH_ROLES: Role[] = [
  'super_admin',
  'operations_manager',
  'dispatcher',
  'fleet_owner',
  'branch_manager',
  'depot_manager',
]

/** InvoicePolicy::READERS and RateCardPolicy::RATE_VIEWERS — identical sets. */
const BILLING_READERS: Role[] = ['super_admin', 'finance', 'operations_manager', 'corporate_admin']

/** The `viewReports` gate in AppServiceProvider — everyone but Driver and Corporate Employee. */
const REPORT_READERS: Role[] = ALL.filter((r) => r !== 'driver' && r !== 'corporate_employee')

/**
 * Nav id -> roles that may use it. An id absent from this map is shown to
 * everyone, which is the right default for the personal entries
 * (dashboard, notifications) that every account has.
 */
const VISIBLE_TO: Record<string, Role[]> = {
  // Bookings and Trips are open to all roles; the server narrows *what* is
  // in them (a Corporate Employee sees their own, a Driver sees theirs), so
  // hiding the entry would remove the one page they most need.
  dispatch: DISPATCH_ROLES,
  invoices: BILLING_READERS,
  'rate-cards': BILLING_READERS,
  reports: REPORT_READERS,
  // Companies, Vehicles and Drivers are `viewAny => true` server-side, but
  // a Corporate Employee requesting a ride has no use for the fleet
  // register or the staff list. Hidden from the two roles that only ever
  // consume transport; still reachable by URL, and still answering 200,
  // because that is what the policies actually say.
  companies: ALL.filter((r) => r !== 'corporate_employee' && r !== 'driver'),
  vehicles: ALL.filter((r) => r !== 'corporate_employee' && r !== 'driver'),
  drivers: ALL.filter((r) => r !== 'corporate_employee' && r !== 'driver'),
}

export function canUseNavItem(role: string | undefined, id: string): boolean {
  if (role === undefined) return false

  const allowed = VISIBLE_TO[id]

  return allowed === undefined || allowed.includes(role)
}

/**
 * Filters a section list for a user, dropping any section left with no
 * items so the heading above it does not survive its own contents.
 */
export function filterSections<S extends { items?: { id: string }[] }>(
  sections: S[],
  user: User | null,
): S[] {
  return sections
    .map((section) => ({
      ...section,
      items: (section.items ?? []).filter((item) => canUseNavItem(user?.role, item.id)),
    }))
    .filter((section) => section.items.length > 0)
}
