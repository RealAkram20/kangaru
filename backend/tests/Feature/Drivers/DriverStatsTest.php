<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Drivers\Services\DriverStatsService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The numbers on a driver's home screen.
 *
 * These are read by somebody deciding whether to keep working, so the
 * arithmetic has to be defensible. The tests below fix the two judgement
 * calls the maths makes — which offer statuses count against a driver, and
 * what an absent denominator means — because both are invisible in the
 * result and both would be easy to "simplify" wrongly later.
 */
function statsDriver(): Driver
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    return Driver::factory()->create(['user_id' => $user->id]);
}

function statsTrip(Driver $driver, string $status, array $overrides = []): Trip
{
    // Both looked up rather than assumed: a hard-coded tenant_id of 1 fails
    // the foreign key on a freshly migrated test database.
    $vehicle = Vehicle::withoutGlobalScopes()->first() ?? Vehicle::factory()->create();
    $tenant = Tenant::withoutGlobalScopes()->first() ?? Tenant::factory()->create();

    return Trip::create(array_merge([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala Road',
        'destination' => 'Ntinda',
        'status' => $status,
    ], $overrides));
}

function statsOffer(Driver $driver, DispatchOfferStatus $status, ?string $offeredAt = null): void
{
    DB::table('dispatch_offers')->insert([
        'driver_id' => $driver->id,
        'status' => $status->value,
        'round' => 1,
        'rank' => 1,
        'offered_at' => $offeredAt ?? now(),
        'expires_at' => now()->addSeconds(15),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

it('answers nulls rather than zeroes for a driver who has done nothing yet', function () {
    $driver = statsDriver();

    $stats = app(DriverStatsService::class)->forDriver($driver);

    // Mutation check — return 0.0 instead of null and this fails. A first-day
    // driver shown "0%" reads it as a failing grade for having done nothing.
    expect($stats['acceptance_rate'])->toBeNull();
    expect($stats['completion_rate'])->toBeNull();
    expect($stats['trips_today'])->toBe(0);
    expect($stats['earnings_today_minor'])->toBe(0);
    expect($stats['wallet_balance_minor'])->toBe(0);
    // ADR-0030 §3: a score is withheld until five ratings exist, and the
    // count is still returned so the app can say what it is waiting for.
    expect($stats['rating'])->toBeNull();
    expect($stats['rating_count'])->toBe(0);
});

/**
 * `superseded` means dispatch pulled the offer back — somebody else took the
 * job. Counting it would penalise a driver for being slower than a machine.
 * `expired` does count: an offer that rang out is a passenger left waiting.
 *
 * Mutation check — include superseded in the denominator and the rate drops
 * to 50%, failing this.
 */
it('counts expired offers against a driver but never superseded ones', function () {
    $driver = statsDriver();

    statsOffer($driver, DispatchOfferStatus::ACCEPTED);
    statsOffer($driver, DispatchOfferStatus::ACCEPTED);
    statsOffer($driver, DispatchOfferStatus::DECLINED);
    statsOffer($driver, DispatchOfferStatus::EXPIRED);
    statsOffer($driver, DispatchOfferStatus::SUPERSEDED);
    statsOffer($driver, DispatchOfferStatus::SUPERSEDED);

    $stats = app(DriverStatsService::class)->forDriver($driver);

    // 2 accepted of 4 answerable.
    expect($stats['acceptance_rate'])->toBe(50.0);
});

it('measures rates over a rolling window, not all time', function () {
    $driver = statsDriver();

    // Ancient history: declined every offer, long ago.
    foreach (range(1, 5) as $i) {
        statsOffer($driver, DispatchOfferStatus::DECLINED, now()->subDays(90)->toDateTimeString());
    }

    statsOffer($driver, DispatchOfferStatus::ACCEPTED);

    $stats = app(DriverStatsService::class)->forDriver($driver);

    // Mutation check — drop the `offered_at >= since` clause and this becomes
    // 16.7%, failing. A driver must be able to work out of a bad first week.
    expect($stats['acceptance_rate'])->toBe(100.0);
    expect($stats['window_days'])->toBe(DriverStatsService::WINDOW_DAYS);
});

it('completes over the endings a trip can actually reach', function () {
    $driver = statsDriver();

    statsTrip($driver, TripStatus::TRIP_COMPLETED->value, ['completed_at' => now()]);
    statsTrip($driver, TripStatus::TRIP_COMPLETED->value, ['completed_at' => now()]);
    statsTrip($driver, TripStatus::TRIP_COMPLETED->value, ['completed_at' => now()]);
    statsTrip($driver, TripStatus::CANCELLED->value);
    // Still running: not an ending, so it belongs in neither half.
    statsTrip($driver, TripStatus::TRIP_STARTED->value);

    $stats = app(DriverStatsService::class)->forDriver($driver);

    // Mutation check — count the in-progress trip in the denominator and this
    // becomes 60%, failing.
    expect($stats['completion_rate'])->toBe(75.0);
});

it("sums today's earnings from the ledger, not the gross fare", function () {
    $driver = statsDriver();

    // A fare of 12,000 at the default 20% leaves the driver 9,600.
    $trip = statsTrip($driver, TripStatus::TRIP_COMPLETED->value, [
        'completed_at' => now(),
        'fare_minor' => 12_000,
        'fare_currency' => 'UGX',
    ]);

    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    $stats = app(DriverStatsService::class)->forDriver($driver);

    // Mutation check — return the gross 12,000 here and this fails. The
    // difference is the whole reason ADR-0029 §5 renamed the tile.
    expect($stats['earnings_today_minor'])->toBe(9_600);
    expect($stats['wallet_balance_minor'])->toBe(9_600 - 2_400);
    expect($stats['trips_today'])->toBe(1);
});

it('never counts another driver in these numbers', function () {
    $mine = statsDriver();
    $theirs = statsDriver();

    statsOffer($theirs, DispatchOfferStatus::DECLINED);
    statsTrip($theirs, TripStatus::TRIP_COMPLETED->value, [
        'completed_at' => now(),
        'fare_minor' => 50_000,
        'fare_currency' => 'UGX',
    ]);

    statsOffer($mine, DispatchOfferStatus::ACCEPTED);

    $stats = app(DriverStatsService::class)->forDriver($mine);

    expect($stats['acceptance_rate'])->toBe(100.0);
    expect($stats['trips_today'])->toBe(0);
    expect($stats['earnings_today_minor'])->toBe(0);
    expect($stats['wallet_balance_minor'])->toBe(0);
    // ADR-0030 §3: a score is withheld until five ratings exist, and the
    // count is still returned so the app can say what it is waiting for.
    expect($stats['rating'])->toBeNull();
    expect($stats['rating_count'])->toBe(0);
});

it('serves the driver their own stats over the driver-scoped token', function () {
    $driver = statsDriver();

    statsTrip($driver, TripStatus::TRIP_COMPLETED->value, [
        'completed_at' => now(),
        'fare_minor' => 7_000,
        'fare_currency' => 'UGX',
    ]);

    $token = $driver->user->createToken('driver', ['driver'])->plainTextToken;

    $this->getJson('/api/v1/me/stats', ['Authorization' => "Bearer {$token}"])
        ->assertOk()
        ->assertJsonPath('data.trips_today', 1)
        ->assertJsonPath('data.wallet_balance_minor', 0);
});

it('refuses an account with no driver profile behind it', function () {
    $staff = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $this->actingAs($staff, 'sanctum')
        ->getJson('/api/v1/me/stats')
        ->assertStatus(403)
        ->assertJsonPath('code', 'NOT_A_DRIVER');
});
