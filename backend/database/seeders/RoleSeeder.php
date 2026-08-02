<?php

namespace Database\Seeders;

use App\Enums\Permission as P;
use App\Enums\UserRole;
use Illuminate\Database\Seeder;
use Modules\Administration\Models\Role;

/**
 * Seeds the ten system roles (ADR-0004).
 *
 * **Every grant below is transcribed from the role comparison it replaces**,
 * so behaviour on the day of the migration is identical to the day before.
 * The provenance is named against each set; `RolePermissionParityTest`
 * asserts the result endpoint by endpoint rather than trusting this comment.
 *
 * Some of these look too generous — a Driver can list vehicles, a Corporate
 * Employee can list companies. Those are not new: `VehiclePolicy::viewAny`
 * and `CompanyPolicy::viewAny` both `return true` today. They are preserved
 * on purpose, because a migration that also tightens rules cannot be
 * verified as a migration. Tightening them is now a UI action rather than a
 * release, which is the point of the feature.
 *
 * Idempotent: re-running updates the permission set of a system role
 * without disturbing custom ones.
 */
class RoleSeeder extends Seeder
{
    public function run(): void
    {
        foreach (self::definitions() as $slug => $definition) {
            Role::query()->updateOrCreate(
                ['slug' => $slug],
                [
                    'name' => $definition['name'],
                    'description' => $definition['description'],
                    'is_system' => true,
                    'permissions' => array_map(fn (P $p) => $p->value, $definition['permissions']),
                ],
            );
        }
    }

    /**
     * @return array<string, array{name: string, description: string, permissions: array<int, P>}>
     */
    public static function definitions(): array
    {
        // Shared sets, named after the constants they come from so the
        // provenance survives. Written once here rather than twice, which
        // is itself one of the drifts ADR-0004 cites.
        $desk = [P::BOOKINGS_VIEW_ALL, P::BOOKINGS_CANCEL_ANY];
        $dispatch = [P::BOOKINGS_DISPATCH, P::TRIPS_CREATE, P::TRIPS_TRANSITION_ANY, P::TRIPS_LOCATIONS_RECORD];
        $fleetManage = [P::VEHICLES_MANAGE, P::DRIVERS_MANAGE];
        // CompanyPolicy/VehiclePolicy/DriverPolicy viewAny all `return true`.
        $everyoneReads = [P::COMPANIES_VIEW, P::VEHICLES_VIEW, P::DRIVERS_VIEW];
        $billingRead = [P::INVOICES_VIEW, P::RATECARDS_VIEW];

        return [
            UserRole::SUPER_ADMIN->value => [
                'name' => 'Super Admin',
                'description' => 'Platform owner. Every permission, including managing roles.',
                'permissions' => P::cases(),
            ],

            UserRole::OPERATIONS_MANAGER->value => [
                'name' => 'Operations Manager',
                'description' => 'Runs operations across the platform: dispatch, fleet and reporting.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage, ...$billingRead,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::DISPATCHER->value => [
                'name' => 'Dispatcher',
                'description' => 'Assigns drivers and vehicles. Cannot approve the bookings they dispatch.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch,
                    // BookingPolicy::APPROVER_ROLES excludes Dispatcher —
                    // "approving your own workload is not a control".
                    P::BOOKINGS_CREATE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::FINANCE->value => [
                'name' => 'Finance',
                'description' => 'Invoices, credit notes and rate cards. Cannot dispatch.',
                'permissions' => [
                    ...$everyoneReads, ...$billingRead,
                    P::BOOKINGS_CREATE, P::TRIPS_VIEW_ALL, P::TRIPS_TRANSITION_FINANCE,
                    P::INVOICES_CREATE, P::INVOICES_CREDIT, P::RATECARDS_MANAGE, P::REPORTS_VIEW,
                ],
            ],

            UserRole::FLEET_OWNER->value => [
                'name' => 'Fleet Owner',
                'description' => 'Manages owned fleets and dispatches them.',
                'permissions' => [
                    ...$everyoneReads, ...$dispatch, ...$fleetManage,
                    P::BOOKINGS_CREATE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::BRANCH_MANAGER->value => [
                'name' => 'Branch Manager',
                'description' => 'Branch operations: approves, dispatches and manages the branch fleet.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::DEPOT_MANAGER->value => [
                'name' => 'Depot Manager',
                'description' => 'Depot vehicles and drivers. Dispatches but does not approve.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage,
                    P::BOOKINGS_CREATE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::CORPORATE_ADMIN->value => [
                'name' => 'Corporate Admin',
                'description' => 'Manages their company\'s staff and bookings. Never dispatches the fleet.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$billingRead,
                    P::AUDIT_VIEW, P::STAFF_VIEW, P::STAFF_MANAGE,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL,
                    P::COMPANIES_UPDATE, P::REPORTS_VIEW,
                ],
            ],

            UserRole::CORPORATE_EMPLOYEE->value => [
                'name' => 'Corporate Employee',
                'description' => 'Requests transport. Sees only their own bookings and trips.',
                'permissions' => [
                    ...$everyoneReads,
                    P::BOOKINGS_CREATE,
                ],
            ],

            UserRole::DRIVER->value => [
                'name' => 'Driver',
                'description' => 'Drives assigned trips and records their progress.',
                'permissions' => [
                    ...$everyoneReads,
                    // BookingPolicy::create is `role !== DRIVER`, so no
                    // BOOKINGS_CREATE here.
                    P::TRIPS_TRANSITION_OWN, P::TRIPS_LOCATIONS_RECORD,
                ],
            ],
        ];
    }
}
