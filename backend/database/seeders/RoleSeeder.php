<?php

namespace Database\Seeders;

use App\Enums\Permission as P;
use App\Enums\RoleAudience as A;
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
                    // Which level of account the role was written for
                    // (ADR-0004, `RoleAudience`). Seeded here as well as
                    // backfilled by the migration, for the same reason
                    // `requires_mfa` is: the migration covers a database that
                    // already had roles, this covers every fresh install and
                    // every test run. Without it the column would fail its own
                    // NOT NULL on a fresh seed.
                    'audience' => $definition['audience'],
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
     *     audience: A,
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
        $everyoneReads = [P::COMPANIES_VIEW, P::VEHICLES_VIEW, P::DRIVERS_VIEW, P::ZONES_VIEW];
        // The two corporate roles read their own company and the zones
        // that price their trips, and no more. The fleet register is
        // Shanitah's (ADR-0005): `DriverResource` carries every driver's
        // phone, licence number and account, and `vehicles.view` opens the
        // VIN and every driver's leave. A bank's transport officer sees the
        // driver and vehicle *on their trip*, nested in that trip — not the
        // roster (docs/security-gate.md F2, the corporate half).
        // ROUTES_VIEW joins the pair since ADR-0045: a client's saved
        // places and circuits are the client's own operational data, and an
        // employee who rides the Monday ATM run has to be able to see it.
        // Building them is `routes.manage`, which only the Corporate Admin
        // holds by role — or a colleague they switch
        // `ClientCapability::MANAGES_ROUTES` on for.
        $clientReads = [P::COMPANIES_VIEW, P::ZONES_VIEW, P::ROUTES_VIEW];
        $billingRead = [P::INVOICES_VIEW, P::RATECARDS_VIEW];

        return [
            UserRole::SUPER_ADMIN->value => [
                'audience' => A::KANGARU,
                'name' => 'Super Admin',
                'description' => 'Platform owner. Every permission, including managing roles.',
                // AGENTS.md: "MFA is required for Super Admin and Finance
                // roles in Phase 1 — these roles can move money and change
                // rates." These two and no others; PROJECT.md puts MFA for
                // everyone else out of Phase 1.
                'requires_mfa' => true,
                // Every permission, `support.act-as` included.
                //
                // **Excluding it was tried and reverted within the hour.**
                // ADR-0056 §6 asks that the grant be "not implied by any
                // other", and holding it out of this list looked like the way
                // to honour that. It is not: `StoreRoleRequest` enforces that
                // *a role cannot grant permissions you do not hold yourself*,
                // so a Super Admin without it could never author a role
                // carrying it — and the permission would be reachable only by
                // a seeder or a hand-written UPDATE. Ungrantable is not
                // stricter, it is broken.
                //
                // What actually keeps it narrow is the **level**: only a
                // `kangaru` account may act as anybody (`ImpersonationService`
                // and the `act-as-another-user` Gate both check it), and a
                // Kangaru account can only be created with a shell on the
                // server. A fleet Super Admin holds this permission and cannot
                // use it.
                'permissions' => P::cases(),
            ],

            UserRole::OPERATIONS_MANAGER->value => [
                'audience' => A::FLEET,
                'name' => 'Operations Manager',
                'description' => 'Runs operations across the platform: dispatch, fleet and reporting.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage, ...$billingRead,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                    P::CUSTOMERS_VIEW,
                    // ADR-0021: a zone boundary decides what a client is
                    // charged, so drawing one sits with operations rather
                    // than with dispatch.
                    P::ZONES_MANAGE,
                    // ADR-0045 §9, read only. Named here rather than added
                    // to `$everyoneReads`, which would hand a client's ATM
                    // estate to every Driver as a side effect — the mirror
                    // of the F2 leak, running the other way.
                    P::ROUTES_VIEW,
                ],
            ],

            UserRole::DISPATCHER->value => [
                'audience' => A::FLEET,
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
                    // ADR-0018: a dispatcher answering the phone has to be
                    // able to find the caller. Read only — suspending an
                    // account is an act with a reason attached and belongs
                    // with the people who answer for it.
                    P::CUSTOMERS_VIEW,
                    // ADR-0045 §9. A dispatcher watching a multi-stop trip
                    // needs the circuit behind it; a stop list with no plan
                    // to read it against is unreadable.
                    P::ROUTES_VIEW,
                ],
            ],

            UserRole::FINANCE->value => [
                'audience' => A::FLEET,
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
                'audience' => A::FLEET,
                'name' => 'Fleet Owner',
                'description' => 'Runs a fleet company: its people, its vehicles and its dispatch.',
                'permissions' => [
                    /*
                     * The union of every other fleet role, and that is a
                     * requirement rather than generosity.
                     *
                     * ADR-0004: *nobody may grant a permission they do not
                     * themselves hold.* So an owner who cannot dispatch cannot
                     * hire a Dispatcher — the subset test refuses the role, and
                     * `staff.manage` on its own would produce an Add colleague
                     * button whose every choice was rejected. ADR-0004 says
                     * exactly this and calls it the remedy: *"a Super Admin
                     * composes a role that holds `staff.manage` **and** the
                     * permissions that role should be able to hand out."*
                     *
                     * Computed against the six roles below rather than picked
                     * by feel: Operations Manager, Dispatcher, Finance, Branch
                     * Manager, Depot Manager and Driver. Branch and Depot are
                     * already inside Operations Manager's set, so the union is
                     * the first three plus the driver's own transition.
                     *
                     * What bounds this is the **fleet**, not the catalogue. An
                     * owner holding all of it still reaches only their own
                     * company's rows (ADR-0065), which is what makes "can do
                     * anything within their fleet" a safe sentence to write.
                     */
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage, ...$billingRead,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                    P::CUSTOMERS_VIEW, P::ZONES_MANAGE, P::ROUTES_VIEW,
                    // Dispatcher's, beyond the shared dispatch set.
                    P::ORDER_REQUESTS_MANAGE,
                    // Finance's. A fleet bills its own corporate clients
                    // (ADR-0055 §5), so its owner must be able to hire
                    // somebody who can.
                    P::TRIPS_TRANSITION_FINANCE, P::INVOICES_CREATE, P::INVOICES_CREDIT,
                    P::RATECARDS_MANAGE,
                    // The driver's own transition, which is the only thing in
                    // that role an owner did not already hold.
                    P::TRIPS_TRANSITION_OWN,
                    /*
                     * A fleet's own staff, and the reason this plan exists.
                     *
                     * Until now the owner of a fleet could hire drivers and
                     * buy vehicles but could not add a dispatcher — Najjemba's
                     * owner held fourteen permissions and not one of them was
                     * `staff.*`, so the second fleet on the platform had
                     * exactly one usable account. Every fleet has an owner by
                     * construction (ADR-0059 §5), which makes this the right
                     * role to carry it: it is the account that always exists
                     * and the one support acts as.
                     *
                     * **This is what makes ADR-0065 load-bearing rather than
                     * theoretical.** Before it, `UserPolicy` let any
                     * fleet-level holder of `staff.manage` read and edit every
                     * other fleet's accounts; nothing exploited it only
                     * because no fleet role held the permission. This line is
                     * what would have made it live, so it does not land
                     * without that fix — see the plan's S0.
                     *
                     * `roles.manage` is deliberately **not** here. A fleet
                     * composes no roles; the catalogue is Kangaru's and every
                     * organisation picks from it (ADR-0004). What a fleet
                     * needs is to put its people into roles that already
                     * exist, which is `staff.manage` and nothing more.
                     */
                    P::STAFF_VIEW, P::STAFF_MANAGE,
                ],
            ],

            UserRole::BRANCH_MANAGER->value => [
                'audience' => A::FLEET,
                'name' => 'Branch Manager',
                'description' => 'Branch operations: approves, dispatches and manages the branch fleet.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::DEPOT_MANAGER->value => [
                'audience' => A::FLEET,
                'name' => 'Depot Manager',
                'description' => 'Depot vehicles and drivers. Dispatches but does not approve.',
                'permissions' => [
                    ...$everyoneReads, ...$desk, ...$dispatch, ...$fleetManage,
                    P::BOOKINGS_CREATE, P::TRIPS_VIEW_ALL, P::REPORTS_VIEW,
                ],
            ],

            UserRole::CORPORATE_ADMIN->value => [
                'audience' => A::CLIENT,
                'name' => 'Corporate Admin',
                'description' => 'Manages their company\'s staff and bookings. Never dispatches the fleet.',
                'permissions' => [
                    ...$clientReads, ...$desk, ...$billingRead,
                    P::AUDIT_VIEW, P::STAFF_VIEW, P::STAFF_MANAGE,
                    P::BOOKINGS_CREATE, P::BOOKINGS_APPROVE, P::TRIPS_VIEW_ALL,
                    P::COMPANIES_UPDATE, P::REPORTS_VIEW,
                    // ADR-0045 §9: building the circuit is the client's act,
                    // not Shanitah's. This is also what makes
                    // `ClientCapability::MANAGES_ROUTES` grantable — a
                    // capability may only pass on a permission the granting
                    // administrator holds themselves.
                    P::ROUTES_MANAGE,
                    // A party to the contract may read it. Agreeing one is
                    // Shanitah's side of the deal, so no ALLOCATIONS_MANAGE
                    // here — that stays with the Super Admin.
                    P::ALLOCATIONS_VIEW,
                ],
            ],

            UserRole::CORPORATE_EMPLOYEE->value => [
                'audience' => A::CLIENT,
                'name' => 'Corporate Employee',
                'description' => 'Requests transport. Sees only their own bookings and trips.',
                'permissions' => [
                    ...$clientReads,
                    P::BOOKINGS_CREATE,
                ],
            ],

            UserRole::DRIVER->value => [
                'audience' => A::FLEET,
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
