<?php

use App\Enums\AccessLevel;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\ValidatesOpenApiContract;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind a different classes or traits.
|
*/

// ValidatesOpenApiContract is the ADR-0011 gate: it wraps every HTTP
// round-trip these suites make and validates the JSON response against
// docs/api/openapi.yaml. The ~471 existing round-trips are the contract
// tests — there is no second suite.
pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class, ValidatesOpenApiContract::class)
    ->in('Feature');

// Concurrency tests spawn real OS processes that must see the fixture data,
// so they truncate committed rows between tests instead of rolling back an
// uncommitted transaction the child processes could never read.
pest()->extend(TestCase::class)
    ->use(DatabaseTruncation::class, ValidatesOpenApiContract::class)
    ->in('Concurrency');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

function something()
{
    // ..
}

/**
 * A head-office account (ADR-0055 §4, ADR-0059).
 *
 * Shared rather than per-file because two suites had grown their own and a
 * third was about to: this is the one fixture whose columns must be *exactly*
 * right, since "no fleet and no client" is head office and getting it wrong
 * silently promotes or demotes the actor instead of failing.
 *
 * Three things it must do, and each was learned from a test that went wrong
 * without it:
 *
 * - `access_level` is **declared**. `UserFactory` gives any tenant-less
 *   fixture Shanitah's `operator_id`, deliberately, so the 200-odd older
 *   fixtures kept meaning "one of Shanitah's people" when the column arrived.
 *   Head office therefore has to say so and clear the fleet by hand.
 * - The role is a **string slug**, not a `UserRole` case. `roleRecord()` joins
 *   on the slug column, so an enum leaves the relation resolving to null and
 *   `requiresMfa()` short-circuits to false — the same class-cast quirk
 *   `roleSlug()` exists for. A fixture that is accidentally exempt from the
 *   second factor is not testing the account anybody actually has.
 * - It is **enrolled**, because `super_admin` requires a second factor
 *   (ADR-0008) and head office is precisely the account that must not be
 *   exempt. Without it `EnsureMfaEnrolled` answers 403 before the endpoint
 *   under test ever runs.
 */
function headOffice(string $role = 'super_admin'): User
{
    $user = User::factory()->create([
        'role' => $role,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'mfa_secret' => 'JBSWY3DPEHPK3PXP',
        'mfa_confirmed_at' => now(),
    ]);

    return $user;
}
