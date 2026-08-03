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
                    // ADR-0008. Seeded here as well as set by the migration,
                    // and both are needed: the migration covers a database
                    // that already had roles in it, this covers every fresh
                    // install and every test run. Without it the flag would
                    // default false on a new database and the requirement
                    // would be *silently off* everywhere it had never been
                    // switched on — the exact failure mode ADR-0008 rejects
                    // an enforcement bypass for.
                    'requires_mfa' => $definition['requires_mfa'] ?? false,
                ],
            );
        }
    }

    /**
     * @return array<string, array{
     *     name: string,
     *     description: string,
     *     permissions: array<int, P>,
     *     requires_mfa?: bool
     * }>
     */
    public static function definitions(): array
    {
        // Shared sets, named after the constants they come from so the
        // provenance survives. Written once here rather than twice, which
        // is itself one of the drifts ADR-0004 cites.
        $desk = [P::BOOKINGS_VIEW_ALL, P::BOOKINGS_CANCEL_ANY];
        // ALLOCATIONS_VIEW rides with dispatch since ADR-0009: allocated
        // vehicles rank first for their client's bookings, and a dispatcher
        // who cannot see the contract cannot tell a considered ranking from
        // an arbitrary one — nor answer for overriding it.
        $dispatch = [
            P::BOOKINGS_DISPATCH, P::TRIPS_CREATE, P::TRIPS_TRANSITION_ANY,
            P::TRIPS_LOCATIONS_RECORD, P::ALLOCATIONS_VIEW,
        ];
        $fleetManage = [P::VEHICLES_MANAGE, P::DRIVERS_MANAGE];
        // CompanyPolicy/VehiclePolicy/DriverPolicy viewAny all `return true`.
        $everyoneReads = [P::COMPANIES_VIEW, P::VEHICLES_VIEW, P::DRIVERS_VIEW];
        $billingRead = [P::INVOICES_VIEW, P::RATECARDS_VIEW];

        return [
            UserRole::SUPER_ADMIN->value => [
                'name' => 'Super Admin',
                'description' => 'Platform owner. Every permission, including managing roles.',
                // AGENTS.md: "MFA is required for Super Admin and Finance
                // roles in Phase 1 — these roles can move money and change
                // rates." These two and no others; PROJECT.md puts MFA for
                // everyone else out of Phase 1.
                'requires_mfa' => true,
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
                    // ADR-0012: the walk-in queue is dispatch work — the
                    // request that has waited longest is the next call.
                    P::ORDER_REQUESTS_MANAGE,
                ],
            ],

            UserRole::FINANCE->value => [
                'name' => 'Finance',
                'description' => 'Invoices, credit notes and rate cards. Cannot dispatch.',
                'requires_mfa' => true,
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
                    // A party to the contract may read it. Agreeing one is
                    // Shanitah's side of the deal, so no ALLOCATIONS_MANAGE
                    // here — that stays with the Super Admin.
                    P::ALLOCATIONS_VIEW,
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
