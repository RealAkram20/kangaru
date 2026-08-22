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

/** Modules\Administration\Policies\UserPolicy::ADMINISTRATORS. */
const USER_ADMINISTRATORS: Role[] = ['super_admin', 'corporate_admin']

/** InvoicePolicy::READERS and RateCardPolicy::RATE_VIEWERS — identical sets. */
const BILLING_READERS: Role[] = ['super_admin', 'finance', 'operations_manager', 'corporate_admin']

/** The `viewReports` gate in AppServiceProvider — everyone but Driver and Corporate Employee. */
const REPORT_READERS: Role[] = ALL.filter((r) => r !== 'driver' && r !== 'corporate_employee')

/**
 * The two roles a corporate client's people sign in with. They consume
 * transport; they do not run the fleet. RoleSeeder gives neither
 * `drivers.view` nor `vehicles.view` (docs/security-gate.md F2), so the
 * fleet register answers 403 to them — and the driver on their trip is
 * nested in that trip, which is where they read it.
 */
const CORPORATE_ROLES: Role[] = ['corporate_admin', 'corporate_employee']

export function isCorporateRole(role: string | undefined): boolean {
  return role !== undefined && CORPORATE_ROLES.includes(role)
}

/** Everyone but the client's people and the driver: the roles that operate the fleet. */
const FLEET_OPERATORS: Role[] = ALL.filter((r) => !CORPORATE_ROLES.includes(r) && r !== 'driver')

/**
 * Nav id -> roles that may use it. An id absent from this map is shown to
 * everyone, which is the right default for the personal entries
 * (dashboard, notifications) that every account has.
 */
const VISIBLE_TO: Record<string, Role[]> = {
  // RoleSeeder's `order_requests.manage` grant (ADR-0012): Dispatcher plus
  // the Super Admin who holds everything. Menu visibility only; the
  // /order-requests route is not behind RequireNavAccess, for the same
  // reason Roles is not — a custom role holding the permission is invisible
  // to a slug list, and the page gates on whether the API answers.
  'walk-ins': ['super_admin', 'dispatcher'],
  // Bookings and Trips are open to all roles; the server narrows *what* is
  // in them (a Corporate Employee sees their own, a Driver sees theirs), so
  // hiding the entry would remove the one page they most need.
  dispatch: DISPATCH_ROLES,
  staff: USER_ADMINISTRATORS,
  // Modules\Administration\Policies\RolePolicy::viewAny — `roles.manage`
  // or `staff.view`, which as seeded is exactly this pair. A Corporate
  // Admin reads the catalogue they assign from; only a Super Admin writes
  // it, and RolesPage renders read-only for the rest.
  //
  // Menu visibility only. The /roles route is deliberately NOT behind
  // RequireNavAccess: a *custom* role holding `roles.manage` is invisible
  // to a slug list, and locking it out of the role editor would be this
  // map contradicting the very feature it is listing. Such a holder
  // reaches the page by URL and the server serves them.
  //
  // Owner's decision, 2026-08-19: not offered to a Corporate Admin after
  // all. The page is the platform's whole catalogue — Dispatcher, Fleet
  // Owner, Driver — none of which a client may assign, and Staff's role
  // picker already offers exactly the two they may (`meta.assignable_roles`).
  // Still theirs by URL and by policy; just not a door in their menu.
  roles: ['super_admin'],
  // Modules\Administration\Policies\AuditLogPolicy::viewAny — `audit.view`,
  // seeded on Super Admin and Corporate Admin. Menu visibility only; the
  // /audit-log route is not behind RequireNavAccess, for the same reason
  // Roles is not.
  //
  // Owner's decision, 2026-08-19: off the client's menu. To a bank's
  // transport officer the feed is mostly the platform's own housekeeping
  // ("System created zone #3"); the trip timeline is their audit trail.
  'audit-log': ['super_admin'],
  // SettingPolicy::viewAny — `settings.manage`, held only by Super Admin
  // as seeded (ADR-0014). Menu visibility only; the /system-settings
  // route is not behind RequireNavAccess, for the same reason Roles is
  // not — the page gates on whether the API answers.
  'system-settings': ['super_admin'],
  // CustomerPolicy::viewAny — `customers.view` (ADR-0018), seeded on Super
  // Admin, Operations Manager and Dispatcher. Deliberately closed to a
  // Corporate Admin: these are Shanitah's retail customers, not their
  // staff, and the two populations have different privacy stories.
  customers: ['super_admin', 'operations_manager', 'dispatcher'],
  // ADR-0045. `routes.view` as seeded: both corporate roles (it rides on
  // `$clientReads`) plus the two platform roles that watch multi-stop trips
  // on the live map. Deliberately not the Driver — `routes.view` was kept
  // off `$everyoneReads` precisely so a client's ATM estate does not reach
  // the fleet as a side effect.
  //
  // No `OPENED_BY_CAPABILITY` entry: `manages_routes` grants `routes.manage`
  // over a menu entry both corporate roles already have, so the capability
  // changes what the page lets you do rather than whether it is offered —
  // the same shape as `approves_bookings`.
  routes: ['super_admin', 'operations_manager', 'dispatcher', 'corporate_admin', 'corporate_employee'],
  invoices: BILLING_READERS,
  // Owner's decision, 2026-08-19: rate cards are Shanitah's pricing tables,
  // not the client's. A client reads how each fare was computed on the
  // invoice itself. Policy unchanged; menu only.
  'rate-cards': BILLING_READERS.filter((r) => r !== 'corporate_admin'),
  reports: REPORT_READERS,
  // CompanyPolicy::viewAny is `true` server-side, and a Corporate Admin's
  // one company is their own organisation — the entry is relabelled for
  // them (`navLabel`). A Corporate Employee requesting a ride has no use
  // for it; hidden from them and from the driver, still reachable by URL.
  companies: ALL.filter((r) => r !== 'corporate_employee' && r !== 'driver'),
  // VehiclePolicy / DriverPolicy `viewAny` → `vehicles.view` /
  // `drivers.view`, which RoleSeeder grants to the roles that operate the
  // fleet and withholds from the client's people (docs/security-gate.md
  // F2): the register carries every driver's phone and licence number.
  vehicles: FLEET_OPERATORS,
  drivers: FLEET_OPERATORS,
  // DriverApplicationPolicy::viewAny — `drivers.view`, the same read the
  // fleet list needs. Deciding one takes more (ADR-0027), and the dialog's
  // buttons answer 403 for anybody who lacks it.
  'driver-applications': FLEET_OPERATORS,
  // ADR-0044. SupportRequestPolicy — `drivers.manage`; the queue is about
  // the people who drive, and a client has no business in it.
  'support-requests': FLEET_OPERATORS,
}

/**
 * The label a nav entry wears for a role, where one word means two things.
 * "Companies" is the operator's register of clients; to a client's own
 * administrator the same page is their organisation, and a menu that calls
 * your own bank "Companies" reads as somebody else's console.
 */
export function navLabel(role: string | undefined, id: string, label: string): string {
  if (id === 'companies' && isCorporateRole(role)) return 'Organisation'
  return label
}

/**
 * The path a nav entry points at for a role, where one entry means two things.
 *
 * The companion to `navLabel`, and here for the same reason: `/companies` is
 * the operator's register of many clients, `/company` is one client's own
 * organisation. Renaming the label without moving the address left a bank
 * reading its own profile at a plural URL that means everybody else's clients.
 *
 * Both routes render `CompaniesPage`, which branches on role, so an old
 * bookmark still lands somewhere correct either way.
 */
export function navPath(role: string | undefined, id: string, path: string): string {
  if (id === 'companies' && isCorporateRole(role)) return '/company'
  return path
}

/**
 * Which menu entries a client capability opens, over and above the role
 * (App\Enums\ClientCapability). Mirrors the permission bundles: `sees_finance`
 * is `invoices.view` + `reports.view`; `manages_staff` is `staff.view` +
 * `staff.manage`; `approves_bookings` opens nothing the role did not — the
 * Bookings entry is already everyone's.
 */
const OPENED_BY_CAPABILITY: Record<string, string[]> = {
  sees_finance: ['invoices', 'reports'],
  manages_staff: ['staff'],
}

/**
 * Nav ids that exist at one **level** and not the others (ADR-0059 §1).
 *
 * Separate from `VISIBLE_TO`, which is a role map, because these are not the
 * same question. A role is something an account can be given; a level is not.
 * `fleets` is the register of a fleet's competitors — a fleet company has no
 * business in it whatever role it holds, and `OperatorPolicy` gates on
 * `access_level` for exactly that reason.
 *
 * Answering this with a role list would mean denying every Kangaru-only entry
 * to six fleet roles individually, forever, and one forgotten entry is a fleet
 * reading Kangaru's plans. That fails toward exposure; this fails toward a
 * refusal.
 */
const LEVEL_ONLY: Record<string, string[]> = {
  fleets: ['kangaru'],
}

export function canUseNavLevel(level: string | undefined, id: string): boolean {
  const allowed = LEVEL_ONLY[id]
  if (allowed === undefined) return true

  // An account whose level the API did not send is refused a level-gated
  // entry. `menuFor` defaults an unknown level to the *fleet* menu so nobody
  // is left without navigation; that leniency is for chrome, and it does not
  // extend to a door that only head office may open.
  return level !== undefined && allowed.includes(level)
}

export function canUseNavItem(role: string | undefined, id: string, capabilities: string[] = []): boolean {
  if (role === undefined) return false

  const allowed = VISIBLE_TO[id]
  if (allowed === undefined || allowed.includes(role)) return true

  // A client's person with a switch on: the server grants the permission,
  // so the menu offers the door. Only ever widens, and only for the two
  // corporate roles — a capability on any other role is not a thing.
  return isCorporateRole(role) && capabilities.some((c) => OPENED_BY_CAPABILITY[c]?.includes(id))
}

/**
 * Filters a section list for a user, dropping any section left with no
 * items so the heading above it does not survive its own contents.
 */
export function filterSections<S extends { items?: { id: string; label: string }[] }>(
  sections: S[],
  user: User | null,
): S[] {
  return sections
    .map((section) => ({
      ...section,
      items: (section.items ?? [])
        .filter(
          (item) =>
            canUseNavLevel(user?.access_level, item.id) &&
            canUseNavItem(user?.role, item.id, user?.capabilities ?? []),
        )
        .map((item) => ({ ...item, label: navLabel(user?.role, item.id, item.label) })),
    }))
    .filter((section) => section.items.length > 0)
}
