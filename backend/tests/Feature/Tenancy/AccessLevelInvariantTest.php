<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * The one guard F0 exists for (ADR-0055 §4).
 *
 * "No client and no fleet" describes **Kangaru** — head office. Every one of
 * Shanitah's staff is a null-client row today, and three of the six on the
 * development database are *drivers*. A level inferred from the two columns
 * would have promoted all six with nothing failing anywhere, which is the
 * failure mode nobody reports: the account simply starts working better than
 * it should.
 *
 * So the rule is held in two places on purpose — a model guard that fails with
 * a sentence, and a database CHECK that catches everything which never loads
 * the model. Both are asserted here, because a rule held in one place is a
 * rule that a raw query walks past.
 */
it('refuses to guess that an account with no client and no fleet is head office', function () {
    $user = new User([
        'name' => 'Nobody',
        'email' => 'nobody@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::DISPATCHER,
    ]);

    expect(fn () => $user->save())
        ->toThrow(RuntimeException::class, 'names neither a fleet nor a client');
});

it('lets head office exist when somebody says so out loud', function () {
    $user = new User([
        'name' => 'Head Office',
        'email' => 'hq@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::SUPER_ADMIN,
    ]);
    $user->access_level = AccessLevel::KANGARU;
    $user->save();

    expect($user->fresh()->access_level)->toBe(AccessLevel::KANGARU)
        ->and($user->fresh()->operator_id)->toBeNull()
        ->and($user->fresh()->tenant_id)->toBeNull();
});

it('refuses an account that names both a fleet and a client', function () {
    $user = new User([
        'name' => 'Both',
        'email' => 'both@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::DISPATCHER,
        'tenant_id' => Tenant::factory()->create()->id,
        'operator_id' => Operator::SHANITAH,
    ]);

    expect(fn () => $user->save())
        ->toThrow(RuntimeException::class, 'names both a fleet and a client');
});

it('derives the level from the columns, so no caller has to remember it', function () {
    $fleet = User::factory()->create();
    $client = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    expect($fleet->access_level)->toBe(AccessLevel::FLEET)
        ->and($fleet->operator_id)->toBe(Operator::SHANITAH)
        ->and($client->access_level)->toBe(AccessLevel::CLIENT)
        ->and($client->operator_id)->toBeNull();
});

/**
 * The half the model guard cannot reach.
 *
 * A raw query never loads `User`, so `saving` never runs. This is the shape a
 * future seeder or a hand-written UPDATE would take, and it is exactly how a
 * silent promotion would arrive.
 */
it('stops the database itself from holding a fleet account with no fleet', function () {
    $user = User::factory()->create();

    expect(fn () => DB::table('users')->where('id', $user->id)->update([
        'access_level' => 'fleet',
        'operator_id' => null,
    ]))->toThrow(QueryException::class, 'users_access_level_matches_columns');
});

it('stops the database from quietly promoting a driver to head office', function () {
    $driverAccount = User::factory()->create(['role' => UserRole::DRIVER]);

    // The exact write a naive migration would have performed on all six
    // null-client accounts, three of which are drivers.
    expect(fn () => DB::table('users')->where('id', $driverAccount->id)->update([
        'access_level' => 'kangaru',
    ]))->toThrow(QueryException::class, 'users_access_level_matches_columns');
});

it('keeps the enum and the CHECK constraint saying the same thing', function () {
    // If these two ever disagree, one of them is not being enforced and the
    // other is the only thing standing up. Asserted rather than trusted,
    // because the copy is deliberate (see AccessLevel::permits).
    expect(AccessLevel::KANGARU->permits(null, null))->toBeTrue()
        ->and(AccessLevel::KANGARU->permits(1, null))->toBeFalse()
        ->and(AccessLevel::FLEET->permits(1, null))->toBeTrue()
        ->and(AccessLevel::FLEET->permits(null, null))->toBeFalse()
        ->and(AccessLevel::CLIENT->permits(null, 1))->toBeTrue()
        ->and(AccessLevel::CLIENT->permits(1, 1))->toBeFalse();
});

/* ------------------------------------- the fourth level (ADR-0055 §4 am.) --- */

it('lets an applicant exist, declared, before anybody has decided their fleet', function () {
    $user = new User([
        'name' => 'Hopeful Rider',
        'email' => 'hopeful@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::DRIVER,
    ]);
    $user->access_level = AccessLevel::APPLICANT;
    $user->save();

    // A driver applicant's fleet is chosen by a reviewer at approval, so at
    // submission it is unknown rather than absent. Without this level, every
    // stranger who filled in the form was filed as head office — and the §4
    // guard refused them, which is how this case came to exist.
    expect($user->fresh()->access_level)->toBe(AccessLevel::APPLICANT)
        ->and($user->fresh()->operator_id)->toBeNull()
        ->and($user->fresh()->tenant_id)->toBeNull();
});

it('still refuses to guess between the two levels that share a shape', function () {
    // `kangaru` and `applicant` both mean "no fleet, no client". Adding the
    // fourth level did not weaken §4, whose rule was never "three levels" but
    // *declared, never inferred*. Undeclared still throws.
    $user = new User([
        'name' => 'Undeclared',
        'email' => 'undeclared@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::DRIVER,
    ]);

    expect(fn () => $user->save())
        ->toThrow(RuntimeException::class, 'names neither a fleet nor a client');
});

it('refuses an applicant who somehow names a fleet', function () {
    $user = new User([
        'name' => 'Hopeful Rider',
        'email' => 'hopeful2@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::DRIVER,
    ]);
    $user->access_level = AccessLevel::APPLICANT;
    $user->save();

    expect(fn () => DB::table('users')->where('id', $user->id)->update([
        'access_level' => 'applicant',
        'operator_id' => Operator::SHANITAH,
    ]))->toThrow(QueryException::class, 'users_access_level_matches_columns');
});

it('gives an applicant no reach into anybody s data', function () {
    $applicant = new User([
        'name' => 'Hopeful Rider',
        'email' => 'hopeful3@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::DRIVER,
    ]);
    $applicant->access_level = AccessLevel::APPLICANT;
    $applicant->save();

    User::factory()->create();
    Driver::factory()->create();
    VehicleCategory::create(['key' => 'probe_cat', 'name' => 'Probe']);

    // An applicant reads their own application and nothing else. Not staff,
    // not a fleet's drivers, not even a price list. `isPlatformLevel()` stays
    // FLEET-only, so they never inherit a fleet's reach either.
    expect($applicant->isPlatformLevel())->toBeFalse()
        ->and(User::forActor($applicant)->count())->toBe(0)
        ->and(Driver::forActor($applicant)->count())->toBe(0)
        ->and(VehicleCategory::query()->visibleToActor($applicant)->count())->toBe(0);
});
