import type { User } from '../types/auth'

/**
 * The seeded roles that hold `vehicles.manage` — `RoleSeeder`'s `$fleetManage`
 * grant, which is `VEHICLES_MANAGE` plus `DRIVERS_MANAGE` together.
 *
 * Used by the driver form to decide whether to offer registering a vehicle
 * inline (ADR-0048 §8) or only the fleet picker. It is **not** the
 * authorization: `DriverService::registerVehicle` checks `VehiclePolicy` on
 * the server and answers 403 regardless of what was rendered, which is proved
 * by a test. Same stance as `canManageBilling` — this only avoids offering a
 * form that cannot submit.
 *
 * ## Why it exists at all, given the two permissions coincide today
 *
 * Among the ten seeded roles, everybody with `drivers.manage` also has
 * `vehicles.manage`, so this returns true for every role that can reach the
 * driver form in the first place. The separation is for ADR-0004's **custom**
 * roles: a "Driver Clerk" composed of `drivers.view` + `drivers.manage` +
 * `vehicles.view` is a legitimate and likely thing for an operator to build,
 * and ADR-0048 §9 refuses to let the driver form become a side door into the
 * fleet for them.
 *
 * A custom role therefore falls through to `false` and gets the picker. That
 * is the safe direction to be wrong in: the worst case is a clerk who could
 * have registered a vehicle being asked to pick one instead, rather than a
 * clerk shown a form the server then refuses.
 */
const FLEET_MANAGE_ROLES: string[] = [
  'super_admin',
  'operations_manager',
  'fleet_owner',
  'branch_manager',
  'depot_manager',
]

export function canManageFleet(user: User | null): boolean {
  return user !== null && FLEET_MANAGE_ROLES.includes(user.role)
}
