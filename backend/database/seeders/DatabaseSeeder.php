<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Modules\Clients\Models\Company;

class DatabaseSeeder extends Seeder
{
    /**
     * Seeds two tenants (so the cross-tenant isolation test and manual
     * frontend login both have real data to exercise) plus one
     * platform-level Super Admin.
     */
    public function run(): void
    {
        // First: every user created below resolves its permissions through
        // the role of the same slug (ADR-0004). Seeding users before roles
        // would leave them holding nothing until this ran.
        $this->call(RoleSeeder::class);

        $tenantA = Tenant::create([
            'name' => 'Centenary Bank',
            'slug' => 'centenary-bank',
            'status' => 'active',
        ]);

        Company::allTenants()->create([
            'tenant_id' => $tenantA->id,
            'legal_name' => 'Centenary Bank Uganda Limited',
            'billing_email' => 'transport-billing@centenarybank.test',
            'city' => 'Kampala',
            'country' => 'Uganda',
        ]);

        User::factory()->create([
            'tenant_id' => $tenantA->id,
            'name' => 'Centenary Bank Admin',
            'email' => 'admin@centenarybank.test',
            'role' => UserRole::CORPORATE_ADMIN,
        ]);

        $tenantB = Tenant::create([
            'name' => 'Acme NGO Ltd',
            'slug' => 'acme-ngo-ltd',
            'status' => 'active',
        ]);

        Company::allTenants()->create([
            'tenant_id' => $tenantB->id,
            'legal_name' => 'Acme NGO Ltd',
            'billing_email' => 'billing@acmengo.test',
            'city' => 'Kampala',
            'country' => 'Uganda',
        ]);

        User::factory()->create([
            'tenant_id' => $tenantB->id,
            'name' => 'Acme NGO Admin',
            'email' => 'admin@acmengo.test',
            'role' => UserRole::CORPORATE_ADMIN,
        ]);

        $this->seedPlatformStaff();

        // Fleet and trips for both tenants, driven through the real state
        // machine so the seeded timelines are genuine.
        $this->call(DemoFleetSeeder::class);

        // Three months of closed, invoiced trips behind those, so the
        // reports have periods to group and the tables have depth. Same
        // services, same state machine — see the class docblock.
        $this->call(DemoHistorySeeder::class);
    }

    /**
     * Shanitah's own employees (ADR-0005, ADR-0006). They belong to no
     * tenant, which is what makes them platform staff: `forActor()` drops
     * tenant scoping for them, so one dispatch desk works every client's
     * queue and one Finance officer invoices every client.
     *
     * These used to be seeded *inside* each client tenant — a "Centenary
     * Bank dispatcher" and an "Acme NGO dispatcher", as though the Bank
     * employed them. At two tenants that was survivable; it is not what the
     * business is, and it does not survive fifty.
     *
     * There is deliberately one of each rather than one per client, because
     * that is the point. A second client's bookings are not a second
     * dispatcher's job.
     */
    private function seedPlatformStaff(): void
    {
        User::factory()->create([
            'tenant_id' => null,
            'name' => 'Platform Super Admin',
            'email' => 'superadmin@kangaruride.test',
            'role' => UserRole::SUPER_ADMIN,
        ]);

        User::factory()->create([
            'tenant_id' => null,
            'name' => 'Dispatch Desk',
            'email' => 'dispatch@kangaruride.test',
            'role' => UserRole::DISPATCHER,
        ]);

        // Finance holds `invoices.view`; the dispatcher above does not. Both
        // are platform-level, and that is exactly the pair ADR-0006's mirror
        // isolation test exists to keep honest: belonging to no tenant is
        // not a permission, and the dispatch desk must stay unable to read a
        // client's money.
        User::factory()->create([
            'tenant_id' => null,
            'name' => 'Finance Officer',
            'email' => 'finance@kangaruride.test',
            'role' => UserRole::FINANCE,
        ]);
    }
}
