<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The §10 follow-up the owner decided 2026-08-22: when the register has no
 * answer, the server — never the handset — asks a public geocoder. Same
 * policy and same active-trip gate as the register search beside it, and
 * everything fails soft, because the screen's free-text row is the floor.
 */
function seedSuggestionFixture(TripStatus $status = TripStatus::TRIP_STARTED): array
{
    $tenant = Tenant::factory()->create();
    $vehicle = Vehicle::factory()->create();

    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle($vehicle)
        ->forDriver($driver)
        ->create(['status' => $status, 'destination' => 'Head Office']);

    return compact('tenant', 'vehicle', 'driverUser', 'driver', 'trip');
}

function photonAnswer(): array
{
    return [
        'features' => [
            [
                'geometry' => ['coordinates' => [32.5946, 0.3341]],
                'properties' => ['name' => 'Acacia Mall', 'district' => 'Kololo', 'city' => 'Kampala', 'country' => 'Uganda'],
            ],
            // A near-duplicate of the first — the POI and its address node —
            // which the mapping must collapse to one row.
            [
                'geometry' => ['coordinates' => [32.5946, 0.3341]],
                'properties' => ['name' => 'Acacia Mall', 'district' => 'Kololo', 'city' => 'Kampala', 'country' => 'Uganda'],
            ],
            // No usable pair: skipped outright, because the pin is the whole
            // value of a suggestion over the free-text row.
            [
                'geometry' => ['coordinates' => null],
                'properties' => ['name' => 'Phantom Corner'],
            ],
            // Abroad: the country survives into the detail so a driver is not
            // sent to the wrong Acacia.
            [
                'geometry' => ['coordinates' => [36.8219, -1.2921]],
                'properties' => ['name' => 'Acacia Mall', 'city' => 'Nairobi', 'country' => 'Kenya'],
            ],
        ],
    ];
}

it('answers the trip\'s driver with mapped, deduplicated, located suggestions', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedSuggestionFixture();
    Http::fake(['photon.komoot.io/*' => Http::response(photonAnswer())]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/place-suggestions?q=Acacia")
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.name', 'Acacia Mall')
        ->assertJsonPath('data.0.detail', 'Kololo, Kampala')
        ->assertJsonPath('data.0.latitude', 0.3341)
        ->assertJsonPath('data.0.longitude', 32.5946)
        ->assertJsonPath('data.1.detail', 'Nairobi, Kenya');
});

it('degrades to an empty list when the geocoder is down, never an error screen', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedSuggestionFixture();
    Http::fake(['photon.komoot.io/*' => Http::response(null, 503)]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/place-suggestions?q=Acacia")
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('refuses a query under three characters without spending a geocoder call', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedSuggestionFixture();
    Http::fake();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/place-suggestions?q=Ac")
        ->assertStatus(422);

    Http::assertNothingSent();
});

it('refuses a driver who is not on the trip', function () {
    ['trip' => $trip] = seedSuggestionFixture();
    $otherUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $otherUser->id]);
    Http::fake();

    $this->actingAs($otherUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/place-suggestions?q=Acacia")
        ->assertForbidden();

    Http::assertNothingSent();
});

it('answers 409 once the run is over, like the register search beside it', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedSuggestionFixture(TripStatus::TRIP_COMPLETED);
    Http::fake();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/place-suggestions?q=Acacia")
        ->assertStatus(409);

    Http::assertNothingSent();
});
