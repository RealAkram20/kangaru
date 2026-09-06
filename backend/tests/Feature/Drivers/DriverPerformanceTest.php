<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Carbon\CarbonImmutable;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Fleet\Services\DutySessionService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /me/performance` — the six dials and the weekly card.
 *
 * The mockup drew six rings and a bonus card. Three of those figures did not
 * exist on this platform when it was drawn, and two of the rings were drawn
 * three-quarters full against nothing at all. This suite pins the line that
 * was settled instead:
 *
 * - **Every ratio has a real denominator, or none.** A null target and a null
 *   roster are served rather than zeroes, and the app draws no arc for either.
 *   A zero here is a division waiting to happen; worse, `0 / 0` rendered as a
 *   full ring would congratulate a driver for nothing.
 * - **Cancellation is not the complement of completion.** `no_show` is the
 *   third ending, and a screen built on the assumption that the two sum to 100
 *   would be wrong for every driver who has ever had one.
 * - **The bonus card is absent, not empty, when the scheme is off.**
 */
function performanceDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

function performanceTrip(Driver $driver, string $status, ?CarbonImmutable $completedAt = null): Trip
{
    $vehicle = Vehicle::withoutGlobalScopes()->first() ?? Vehicle::factory()->create();
    $tenant = Tenant::withoutGlobalScopes()->first() ?? Tenant::factory()->create();

    return Trip::create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala Road',
        'destination' => 'Ntinda',
        'status' => $status,
        'completed_at' => $completedAt,
    ]);
}

it('serves nulls rather than zeroes for a driver who has done nothing', function (): void {
    [$user] = performanceDriver();

    $response = $this->actingAs($user)->getJson('/api/v1/me/performance')->assertOk();

    // Every one of these is a dial. A 0.0 would draw an empty ring and read as
    // a failing grade for having done nothing wrong; null draws an em dash.
    $response->assertJsonPath('data.acceptance_rate', null);
    $response->assertJsonPath('data.completion_rate', null);
    $response->assertJsonPath('data.cancellation_rate', null);
    $response->assertJsonPath('data.rating', null);
    $response->assertJsonPath('data.rating_count', 0);
    // ADR-0017 §3: no shift windows means available at any hour, which is not
    // a number to draw an arc against.
    $response->assertJsonPath('data.rostered_seconds_this_week', null);
    // Off by default (ADR-0034). Absent, not an empty card.
    $response->assertJsonPath('data.bonus', null);
});

it('counts cancellation separately from completion, because no-show is the third ending', function (): void {
    [$user, $driver] = performanceDriver();

    performanceTrip($driver, TripStatus::TRIP_COMPLETED->value);
    performanceTrip($driver, TripStatus::TRIP_COMPLETED->value);
    performanceTrip($driver, TripStatus::CANCELLED->value);
    performanceTrip($driver, TripStatus::NO_SHOW->value);

    $response = $this->actingAs($user)->getJson('/api/v1/me/performance')->assertOk();

    // 2 of 4 completed, 1 of 4 cancelled — and the two sum to 75, not 100.
    // Derive cancellation as `100 - completion` and this fails, which is the
    // whole reason it is asserted here: the no-show is nobody's failing and
    // has no dial, but it is in the denominator of both.
    // `toEqual`, not `assertJsonPath`: `round(50.0, 1)` serialises to a JSON
    // `50`, which decodes as an int and fails a strict comparison against
    // `50.0` for reasons that have nothing to do with the rates.
    expect($response->json('data.completion_rate'))->toEqual(50.0);
    expect($response->json('data.cancellation_rate'))->toEqual(25.0);
});

it('agrees with the home screen about acceptance', function (): void {
    [$user, $driver] = performanceDriver();

    performanceTrip($driver, TripStatus::TRIP_COMPLETED->value);
    performanceTrip($driver, TripStatus::CANCELLED->value);

    $performance = $this->actingAs($user)->getJson('/api/v1/me/performance')->assertOk();
    $stats = $this->actingAs($user)->getJson('/api/v1/me/stats')->assertOk();

    // Both read `DriverStatsService::qualityFor()`. Give either surface its own
    // copy of the arithmetic and they drift — which a driver notices, and
    // nobody can explain.
    expect($performance->json('data.completion_rate'))->toBe($stats->json('data.completion_rate'));
    expect($performance->json('data.acceptance_rate'))->toBe($stats->json('data.acceptance_rate'));
});

it('does not widen the home screen payload', function (): void {
    [$user] = performanceDriver();

    $stats = $this->actingAs($user)->getJson('/api/v1/me/stats')->assertOk();

    // `/me/stats` is polled every sixty seconds. Adding a field the home
    // screen does not render costs every handset bytes forever and changes a
    // published contract; the sharing happens in the service, not the payload.
    expect($stats->json('data'))->not->toHaveKey('cancellation_rate');
});

it('reports the driver\'s progress towards the weekly bonus', function (): void {
    [$user, $driver] = performanceDriver();

    app(SettingsService::class)->setGroup('billing', [
        'bonus_enabled' => true,
        'bonus_weekly_trip_target' => 30,
        'bonus_weekly_amount_minor' => 20000,
    ]);

    $timezone = app(DriverEarningsService::class)->timezone();
    $thisWeek = CarbonImmutable::now($timezone)->startOfWeek()->startOfDay()->addHours(9);

    foreach (range(1, 3) as $ignored) {
        performanceTrip($driver, TripStatus::TRIP_COMPLETED->value, $thisWeek);
    }

    // Last week's work must not count towards this week's target.
    performanceTrip($driver, TripStatus::TRIP_COMPLETED->value, $thisWeek->subWeek());

    $response = $this->actingAs($user)->getJson('/api/v1/me/performance')->assertOk();

    $response->assertJsonPath('data.trips_this_week', 3);
    $response->assertJsonPath('data.bonus.trips', 3);
    $response->assertJsonPath('data.bonus.trip_target', 30);
    $response->assertJsonPath('data.bonus.achieved', false);
    // The lifetime count is a different question and includes last week's.
    $response->assertJsonPath('data.trips_total', 4);
});

it('withholds the bonus card entirely when the scheme is off', function (): void {
    [$user, $driver] = performanceDriver();

    app(SettingsService::class)->setGroup('billing', ['bonus_enabled' => false]);

    performanceTrip($driver, TripStatus::TRIP_COMPLETED->value, CarbonImmutable::now());

    $response = $this->actingAs($user)->getJson('/api/v1/me/performance')->assertOk();

    // The count is still true and is still served — it is the dial's value.
    // What is withheld is the *target*, because there isn't one: a card
    // reading "1 of 40 trips" for a fleet running no bonus scheme is an
    // invented figure dressed as a measurement.
    $response->assertJsonPath('data.trips_this_week', 1);
    $response->assertJsonPath('data.bonus', null);
});

it('serves the hours a driver was actually online this week', function (): void {
    [$user, $driver] = performanceDriver();

    $timezone = app(DriverEarningsService::class)->timezone();
    $weekStart = CarbonImmutable::now($timezone)->startOfWeek()->startOfDay();

    /*
     * The clock is pinned to Thursday, and that is the fix rather than the
     * setup.
     *
     * This test opened a shift at `$weekStart->addHours(6)` — 06:00 on Monday
     * in Africa/Kampala — and asserted seven hours were counted. Between
     * midnight and 06:00 Kampala **on a Monday**, that instant is in the
     * *future*: the session is not counted, the assertion gets 0 instead of
     * 25200, and CI is red for six hours every Monday morning.
     *
     * Deterministic, not flaky. Found by kangaru-45, who watched it pass at
     * 23:0x UTC and fail at 21:1x UTC with nothing touching Drivers in
     * between — which is 00:1x Monday in Kampala.
     *
     * Pinning mid-week keeps the shift inside *this* week (so the boundary
     * the test is actually about is unchanged) and firmly in the past (so the
     * hours are countable at any hour the suite runs).
     */
    $this->travelTo($weekStart->addDays(3)->addHours(12));

    $sessions = app(DutySessionService::class);

    // A closed shift inside this week, and now unambiguously behind us.
    $sessions->open($driver->id, null, $weekStart->addHours(6));
    $sessions->close($driver->id, $weekStart->addHours(13));

    // And one from last week, which must not be counted.
    $sessions->open($driver->id, null, $weekStart->subDays(3));
    $sessions->close($driver->id, $weekStart->subDays(3)->addHours(5));

    $response = $this->actingAs($user)->getJson('/api/v1/me/performance')->assertOk();

    $response->assertJsonPath('data.online_seconds_this_week', 7 * 3600);
});

it('is reachable by a driver-app token', function (): void {
    [$user] = performanceDriver();

    // **This is the assertion no other test in this file makes for me.**
    // `ClientScope` fails closed, and every other test here signs in without a
    // client — minting an unscoped console token — so the endpoint would pass
    // all of them while being 403 to the only app that has a screen for it.
    // Four money endpoints shipped exactly that way.
    expect(ClientScope::routesFor(ClientScope::DRIVER))->toContain('me.performance.show');

    $token = $user->createToken('driver-app', ClientScope::abilitiesFor(ClientScope::DRIVER))->plainTextToken;

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/me/performance')
        ->assertOk();
});

it('refuses an account that is not a driver', function (): void {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user)->getJson('/api/v1/me/performance')->assertForbidden();
});
