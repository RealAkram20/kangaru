<?php

namespace Database\Seeders;

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Modules\Clients\Models\Company;
use RuntimeException;

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
            // A work number, because the booking dialog prefills the contact
            // number off the picked colleague (ADR-0064) — a demo directory
            // of numberless accounts makes that prefill look broken.
            'phone' => '+256700100001',
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
            // See the Centenary admin above.
            'phone' => '+256700100002',
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
    /**
     * The TOTP secret every demo account in an MFA-required role shares.
     *
     * Fixed and documented on purpose (ADR-0008 Consequences). The
     * alternative was exempting demo accounts from enforcement by
     * environment, and that is the more dangerous of the two: a bypass that
     * is wrong in production fails *silently* — the system simply stops
     * asking for a second factor and nothing anywhere reports it. A known
     * secret is a worse outcome but a louder one, and `enrolDemoMfa()`
     * below makes it loud by construction.
     *
     * A real Base32 secret rather than a placeholder, so a demo signs in
     * through exactly the code path production runs.
     *
     * **Base32 means A–Z and 2–7 only.** The first version of this constant
     * read `...2026...`, which looks like a year and is not decodable — the
     * seed ran happily and every demo sign-in then failed at the code
     * prompt with no administrator able to reset it.
     */
    private const DEMO_TOTP_SECRET = 'KANGARURIDEDEMOSECRET234567ABCDE';

    private function seedPlatformStaff(): void
    {
        // Head office, and the only account here that is (ADR-0055, ADR-0059).
        //
        // Declared, never left to the factory. `UserFactory` files any
        // client-less account under Shanitah, which is the right default for
        // the rest of this method — a dispatcher dispatches a fleet's trips
        // and a finance officer bills a fleet's clients — and precisely wrong
        // for the one account named "Platform". Before this was explicit, the
        // account called Platform Super Admin was the one account that was
        // not: it got Shanitah's console, and the owner found it by signing in
        // and not recognising the menu.
        //
        // ADR-0055 §4's rule, applied where it bites: the level is stated on
        // the row and never inferred from two nulls.
        $this->enrolDemoMfa(User::factory()->create([
            'tenant_id' => null,
            'operator_id' => null,
            'access_level' => AccessLevel::KANGARU,
            'name' => 'Kangaru Super Admin',
            'email' => 'superadmin@kangaruride.test',
            'role' => UserRole::SUPER_ADMIN,
        ]));

        // Shanitah's own, because promoting the account above took its only
        // Super Admin away — and ADR-0059 §5 is explicit that a fleet with
        // nobody to act as is unreachable to support for ever. The dashboard
        // counts fleets in that state precisely so it cannot happen quietly.
        User::factory()->create([
            'tenant_id' => null,
            'name' => 'Shanitah Super Admin',
            'email' => 'admin@shanitah.test',
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
        $this->enrolDemoMfa(User::factory()->create([
            'tenant_id' => null,
            'name' => 'Finance Officer',
            'email' => 'finance@kangaruride.test',
            'role' => UserRole::FINANCE,
        ]));
    }

    /**
     * Puts the shared demo secret on an account so a demo can actually sign
     * in, and refuses loudly anywhere it would be a backdoor.
     *
     * The factory already enrols MFA-required users, but with a **random**
     * secret — correct for a test, useless for a person, because nobody can
     * produce a code for it. This replaces it with the documented one.
     *
     * The environment guard **throws rather than skips**. Skipping would
     * leave a production Super Admin enrolled against a secret nobody holds
     * and no administrator can reset — ADR-0008's Context describes exactly
     * that account as unrecoverable. Failing the seed is the recoverable
     * outcome; half-running it is not.
     */
    private function enrolDemoMfa(User $user): void
    {
        if (! app()->environment(['local', 'testing', 'staging'])) {
            throw new RuntimeException(
                'Refusing to seed a known TOTP secret in the '.app()->environment().' environment. '
                .'A published second factor is worse than none. Onboard privileged users through '
                .'POST /auth/mfa/enrol instead.'
            );
        }

        $user->forceFill([
            'mfa_secret' => self::DEMO_TOTP_SECRET,
            'mfa_confirmed_at' => now(),
        ])->save();
    }
}
