<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Database\Seeders\DriverAppSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Hash;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * The seeder that makes the Driver's Application testable at all.
 *
 * Worth a suite of its own because the thing it produces has to be *usable*,
 * not merely present: an account that exists but cannot sign in, or a trip in
 * a status the app offers no action from, wastes exactly the ten minutes the
 * seeder was written to save — and does it silently, on somebody else's
 * machine.
 */
function seedDriverAppPlatform(): Tenant
{
    (new RoleSeeder)->run();

    $tenant = Tenant::factory()->create();

    // PlatformStaff::dispatcher() throws without one, by design.
    User::factory()->create([
        'tenant_id' => null,
        'name' => 'Dispatch Desk',
        'email' => 'dispatch@kangaruride.test',
        'role' => UserRole::DISPATCHER,
    ]);

    return $tenant;
}

it('produces a driver account that can actually sign in on the driver app', function () {
    seedDriverAppPlatform();

    (new DriverAppSeeder)->run();

    // The whole point: not "a user row exists" but "this credential opens the
    // app". Posted through the real endpoint, with the client field ADR-0022
    // requires, because that is what the mobile app sends.
    $response = $this->postJson('/api/v1/auth/login', [
        'email' => 'driver@kangaruride.test',
        'password' => 'driver-demo-password',
        'client' => ClientScope::DRIVER,
    ]);

    $response->assertOk();
    expect($response->json('data.token'))->toBeString()->not->toBeEmpty();
});

it('links the account to a driver profile, so the app is not NOT_A_DRIVER', function () {
    seedDriverAppPlatform();

    (new DriverAppSeeder)->run();

    $account = User::query()->where('email', 'driver@kangaruride.test')->first();

    // `role` is the slug string ADR-0004 resolves permissions through, not a
    // cast enum — compared as the value it actually is.
    expect($account)->not->toBeNull()
        ->and((string) $account->role)->toBe(UserRole::DRIVER->value);

    // ADR-0016: the profile is what `TripPolicy` and
    // `/me/availability-requests` resolve the caller through. An account
    // without one signs in and then gets 403 NOT_A_DRIVER on everything.
    expect(Driver::query()->where('user_id', $account->id)->exists())->toBeTrue();
});

it('leaves the driver a trip they can act on', function () {
    seedDriverAppPlatform();

    (new DriverAppSeeder)->run();

    $driver = Driver::query()->whereHas('user', fn ($q) => $q->where('email', 'driver@kangaruride.test'))->sole();

    $live = Trip::allTenants()
        ->where('driver_id', $driver->id)
        ->where('status', TripStatus::ASSIGNED->value)
        ->get();

    expect($live)->toHaveCount(1);

    // Assigned offers accept and decline to a driver, which is the lifecycle's
    // front door. A seeder that parked the trip in a terminal status would
    // hand the tester a screen with no buttons on it.
    expect(TripStatus::ASSIGNED->allowedTransitions())->toContain(TripStatus::ACCEPTED);
});

it('seeds finished trips carrying both odometer readings', function () {
    seedDriverAppPlatform();

    (new DriverAppSeeder)->run();

    $driver = Driver::query()->whereHas('user', fn ($q) => $q->where('email', 'driver@kangaruride.test'))->sole();

    $completed = Trip::allTenants()
        ->where('driver_id', $driver->id)
        ->where('status', TripStatus::TRIP_COMPLETED->value)
        ->get();

    expect($completed)->toHaveCount(2);

    // PROJECT.md's acceptance criteria 4 and 5. A demo whose completed trips
    // have no readings demonstrates the one thing the anchor client is buying
    // as absent.
    $completed->each(function (Trip $trip) {
        expect($trip->odometer_start)->not->toBeNull()
            ->and($trip->odometer_end)->not->toBeNull()
            ->and($trip->odometer_end)->toBeGreaterThanOrEqual($trip->odometer_start)
            ->and($trip->started_at)->not->toBeNull()
            ->and($trip->completed_at)->not->toBeNull();
    });
});

/**
 * Mutation check — delete the `hasLiveTrip()` early return and this fails:
 * the second run asks the assignment guard to put a driver who is already
 * holding an Assigned trip onto another one, and it throws
 * DriverUnavailableException. A seeder that only works once is a seeder
 * people stop running.
 */
it('can be run twice without stacking a second live trip', function () {
    seedDriverAppPlatform();

    (new DriverAppSeeder)->run();
    (new DriverAppSeeder)->run();

    $driver = Driver::query()->whereHas('user', fn ($q) => $q->where('email', 'driver@kangaruride.test'))->sole();

    expect(User::query()->where('email', 'driver@kangaruride.test')->count())->toBe(1);
    expect(
        Trip::allTenants()
            ->where('driver_id', $driver->id)
            ->whereIn('status', TripStatus::occupyingValues())
            ->count(),
    )->toBe(1);
});

/**
 * Mutation check — soften `refuseOutsideDevelopment()` to a `return` and this
 * fails. That branch is the only thing standing between a password committed
 * to this repository and an account holding TRIPS_TRANSITION_OWN against a
 * bank's live trips.
 */
it('refuses to mint the published password outside development', function () {
    seedDriverAppPlatform();

    app()->detectEnvironment(fn () => 'production');

    expect(fn () => (new DriverAppSeeder)->run())
        ->toThrow(RuntimeException::class);

    expect(User::query()->where('email', 'driver@kangaruride.test')->exists())->toBeFalse();
});

it('explains itself rather than half-running when nothing is seeded yet', function () {
    (new RoleSeeder)->run();

    // No tenant. The honest failure is a sentence naming the command to run,
    // not a null-pointer three frames down inside DispatchService.
    expect(fn () => (new DriverAppSeeder)->run())->toThrow(RuntimeException::class);
});

/**
 * The first thing anybody testing the app does to this account is change its
 * password — `auth.password.change` is one of the nineteen routes a driver
 * token reaches. That leaves the credential this seeder prints, and the one
 * written in `mobile/README.md`, wrong; and ADR-0016 provides no self-service
 * reset to recover with.
 *
 * Mutation check — delete the `restorePassword()` call and this fails.
 */
it('puts the documented password back after someone has changed it', function () {
    seedDriverAppPlatform();

    (new DriverAppSeeder)->run();

    User::query()
        ->where('email', 'driver@kangaruride.test')
        ->update(['password' => Hash::make('something-else-entirely')]);

    (new DriverAppSeeder)->run();

    $this->postJson('/api/v1/auth/login', [
        'email' => 'driver@kangaruride.test',
        'password' => 'driver-demo-password',
        'client' => ClientScope::DRIVER,
    ])->assertOk();
});
