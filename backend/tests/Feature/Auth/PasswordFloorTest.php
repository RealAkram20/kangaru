<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\PasswordPolicy;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;

/**
 * One password floor, at every door.
 *
 * Before `PasswordPolicy` the number lived in eight places and disagreed with
 * itself in three: twelve at the two doors where the office mints an account
 * for somebody else, eight at the four a person walks through for themselves,
 * a plain `min:8` string rule at the customer register, and an unconfigured
 * `Password::defaults()` in the console command — Laravel's own eight, by
 * accident rather than by decision.
 *
 * The spread was not theoretical. It had already produced a dialog that set a
 * driver's password at twelve while telling the office to *"ask them to change
 * it from their own profile afterwards"*, and a profile screen that promised
 * twelve for a door accepting eight.
 *
 * ## What each half of this file catches
 *
 * The **boundary** tests below walk real HTTP endpoints and pin the floor from
 * both sides: the shortest allowed password is accepted, one character less is
 * refused. A one-sided test ("short passwords are rejected") passes just as
 * happily when the floor has silently risen, which is the direction this
 * platform drifted in for months.
 *
 * The **census** is the half that catches what boundary tests cannot: a door
 * added *tomorrow* that states its own number. No test written today walks a
 * route that does not exist yet, so the guard has to be over the source.
 */
function floorTenant(): Tenant
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    return $tenant;
}

/** Exactly at the floor: the shortest password the platform accepts. */
function atTheFloor(): string
{
    return str_repeat('k', PasswordPolicy::MINIMUM_LENGTH);
}

/** One character short of it. */
function belowTheFloor(): string
{
    return str_repeat('k', PasswordPolicy::MINIMUM_LENGTH - 1);
}

it('states its floor as six', function () {
    // The owner set this number on 24 August 2026, deliberately and for every
    // door. Pinned as a literal rather than derived, so that changing the
    // constant is a decision somebody has to come here and confirm rather than
    // a one-character edit that no test notices.
    expect(PasswordPolicy::MINIMUM_LENGTH)->toBe(6);
});

/*
 * ---------------------------------------------------------------------------
 * The boundary, at the doors that can be walked without a token in the post.
 * ---------------------------------------------------------------------------
 */

it('mints a driver sign-in at the floor, and refuses one character less', function () {
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $atFloor = Driver::factory()->create();
    $below = Driver::factory()->create();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/drivers/{$atFloor->id}/account", [
            'email' => 'at-the-floor@kangaruride.test',
            'password' => atTheFloor(),
        ])
        ->assertCreated();

    // And the password actually works, which is the claim that matters: a
    // rule that accepts a value the login door then refuses would pass an
    // assertion on the 201 alone.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'at-the-floor@kangaruride.test',
        'password' => atTheFloor(),
    ])->assertOk();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/drivers/{$below->id}/account", [
            'email' => 'below-the-floor@kangaruride.test',
            'password' => belowTheFloor(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('password');
});

it('mints a staff account at the floor, and refuses one character less', function () {
    $tenant = floorTenant();
    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $payload = [
        'name' => 'Peter Ochieng',
        'role' => 'corporate_employee',
        'phone' => '+256700000001',
    ];

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/users', [
            ...$payload,
            'email' => 'at-the-floor@centenary-bank.test',
            'password' => atTheFloor(),
        ])
        ->assertStatus(201);

    // This is the door the owner was asked about separately, and answered
    // yes to: staff and super-admin minting comes down with the rest. Their
    // second factor, not their first, is what guards those accounts.
    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/users', [
            ...$payload,
            'email' => 'below-the-floor@centenary-bank.test',
            'password' => belowTheFloor(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('password');
});

it('lets a person change their own password to one at the floor', function () {
    $tenant = floorTenant();
    $user = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'password' => 'the-original-password',
    ]);

    // The other half of the driver sign-in dialog's own instruction. Before
    // this change the office minted at twelve and this door accepted eight,
    // so the two rules a person met inside one minute were different ones.
    $this->actingAs($user, 'sanctum')
        ->patchJson('/api/v1/auth/password', [
            'current_password' => 'the-original-password',
            'password' => atTheFloor(),
            'password_confirmation' => atTheFloor(),
        ])
        ->assertOk();

    $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => atTheFloor(),
    ])->assertOk();
});

it('refuses a self-chosen password below the floor', function () {
    $tenant = floorTenant();
    $user = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'password' => 'the-original-password',
    ]);

    $this->actingAs($user, 'sanctum')
        ->patchJson('/api/v1/auth/password', [
            'current_password' => 'the-original-password',
            'password' => belowTheFloor(),
            'password_confirmation' => belowTheFloor(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('password');
});

it('registers a customer at the floor, and says the number rather than a stale one', function () {
    $payload = [
        'first_name' => 'Nakato',
        'last_name' => 'Grace',
        'phone' => '+256700000002',
    ];

    $this->postJson('/api/v1/customer/auth/register', [
        ...$payload,
        'email' => 'at-the-floor@example.test',
        'password' => atTheFloor(),
    ])->assertStatus(201);

    // This door keeps its own friendlier sentence, and that sentence
    // interpolates `:min`. It used to write "8" out in full, which is exactly
    // how a message outlives the rule it describes.
    $this->postJson('/api/v1/customer/auth/register', [
        ...$payload,
        'email' => 'below-the-floor@example.test',
        'password' => belowTheFloor(),
    ])
        ->assertStatus(422)
        ->assertJsonPath(
            'errors.password.0',
            'Please choose a password of at least '.PasswordPolicy::MINIMUM_LENGTH.' characters.',
        );
});

/*
 * ---------------------------------------------------------------------------
 * The census: nowhere else may state a password floor.
 * ---------------------------------------------------------------------------
 */

it('states the password floor in exactly one file', function () {
    $roots = [
        base_path('app'),
        base_path('Modules'),
    ];

    /*
     * `Password::min(` — a door with its own number.
     * `Password::defaults(` — a door reading a default nothing configures,
     *   which is how the console command came to sit at Laravel's eight
     *   without a line of this codebase saying so.
     */
    $offenders = [];

    foreach ($roots as $root) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));

        foreach ($files as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $path = str_replace('\\', '/', $file->getPathname());

            if (str_ends_with($path, 'app/Support/Auth/PasswordPolicy.php')) {
                continue;
            }

            $source = (string) file_get_contents($file->getPathname());

            // Comments mention these names legitimately; only a call counts.
            $source = (string) preg_replace('~^\s*(//|\*|/\*).*$~m', '', $source);

            if (preg_match('/Password::(min|defaults)\s*\(/', $source) === 1) {
                $offenders[] = $path;
            }
        }
    }

    // Counted, not merely asserted empty-or-not: the message has to name the
    // file, because "a password floor is stated somewhere else" is useless to
    // the person who just added it.
    expect($offenders)->toBe([], 'These state their own password floor; use PasswordPolicy::rule(): '.implode(', ', $offenders));
});
