<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0035: an impossible odometer reading is refused at the transition, so it
 * never becomes a trip and therefore never becomes a fare.
 *
 * The bug this exists for: a closing reading of 100005 against an opening of
 * 10001 recorded a 90,004 km journey and priced it at UGX 198,013,800. The
 * floor (closing below opening) has always been refused; this is the other end
 * of the same rule.
 *
 * `TripStateMachineTest` owns the floor. This suite owns the ceiling and the
 * fact that the limit is the office's number rather than a constant.
 */

/** A trip driven as far as Passenger Onboard, with its opening reading taken. */
function tripAwaitingClosingReading(int $odometerStart = 10_000): array
{
    $tenant = Tenant::factory()->create();

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create();

    TripEvent::create([
        'tenant_id' => $tenant->id, 'trip_id' => $trip->id, 'from_status' => null,
        'to_status' => TripStatus::ASSIGNED, 'user_id' => null, 'notes' => null,
    ]);

    $dispatcher = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::OPERATIONS_MANAGER,
    ]);

    foreach ([
        TripStatus::ACCEPTED,
        TripStatus::DRIVER_EN_ROUTE,
        TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD,
    ] as $status) {
        test()->actingAs($dispatcher, 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => $status->value])
            ->assertOk();
    }

    test()->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value,
            'odometer_start' => $odometerStart,
        ])->assertOk();

    return [$dispatcher, $trip->fresh()];
}

it('refuses a closing reading beyond the plausible ceiling', function () {
    [$dispatcher, $trip] = tripAwaitingClosingReading(10_001);

    // The exact reading that shipped: one digit too many.
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 100_005,
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');

    // Refused means refused: the trip has not moved and carries no distance
    // for anything downstream to price.
    $fresh = $trip->fresh();
    expect($fresh->status)->toBe(TripStatus::TRIP_STARTED)
        ->and($fresh->odometer_end)->toBeNull()
        ->and($fresh->distance_km)->toBeNull();
});

it('names the figure and the limit, rather than saying the reading is invalid', function () {
    [$dispatcher, $trip] = tripAwaitingClosingReading(10_001);

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 100_005,
        ])->assertStatus(422);

    // A driver reading this at the kerb has to know what to change and to
    // what. "Invalid" tells them neither.
    $message = json_encode($response->json('errors.odometer_end'));

    expect($message)->toContain('90004')
        ->and($message)->toContain('2000');
});

it('accepts a long but plausible journey', function () {
    [$dispatcher, $trip] = tripAwaitingClosingReading(10_000);

    // 1,900 km — beyond anything this platform dispatches, and still under the
    // default ceiling. The ceiling catches typos; it does not adjudicate
    // long-distance work.
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 11_900,
        ])->assertOk();

    expect($trip->fresh()->distance_km)->toEqual('1900.00');
});

it('takes the ceiling from settings, not from a constant', function () {
    app(SettingsService::class)->setGroup('tracking', ['odometer_max_km_per_trip' => 50]);

    [$dispatcher, $trip] = tripAwaitingClosingReading(10_000);

    // 60 km clears the shipped default of 2,000 comfortably and is refused,
    // because the office said 50.
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 10_060,
        ])->assertStatus(422);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 10_040,
        ])->assertOk();
});

it('reports a reading below the opening one as too small only', function () {
    [$dispatcher, $trip] = tripAwaitingClosingReading(15_000);

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 14_000,
        ])->assertStatus(422);

    // Both checks look at the same field. Telling a driver their number is
    // simultaneously too small and too large is two ways of saying one thing.
    $errors = $response->json('errors.odometer_end');

    expect($errors)->toHaveCount(1)
        ->and($errors[0])->toContain('cannot be less than the opening reading');
});

// The variance threshold's move into settings is proved in
// `OdometerReconciliationTest`, against the state machine that consumes it. A
// test here would only have asserted that SettingsService stores what it was
// given, which is true of every key and says nothing about the flag.
