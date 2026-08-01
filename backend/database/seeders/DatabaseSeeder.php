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

        User::factory()->create([
            'tenant_id' => null,
            'name' => 'Platform Super Admin',
            'email' => 'superadmin@kangaruride.test',
            'role' => UserRole::SUPER_ADMIN,
        ]);

        // Fleet and trips for both tenants, driven through the real state
        // machine so the seeded timelines are genuine.
        $this->call(DemoFleetSeeder::class);
    }
}
