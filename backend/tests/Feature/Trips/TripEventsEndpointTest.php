<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

function seedTripEventsFixture(): array
{
    $tenant = Tenant::factory()->create();

    $vehicle = Vehicle::factory()->forTenant($tenant)->van()->create();
    $driver = Driver::factory()->forTenant($tenant)->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    $trip = Trip::factory()->forTenant($tenant)->forVehicle($vehicle)->forDriver($driver)
        ->create(['origin' => 'Kampala', 'destination' => 'Entebbe']);
    TripEvent::create([
        'tenant_id' => $tenant->id, 'trip_id' => $trip->id, 'from_status' => null,
        'to_status' => TripStatus::ASSIGNED, 'user_id' => $dispatcher->id, 'notes' => null,
    ]);

    return compact('tenant', 'dispatcher', 'trip');
}

it('returns the trip timeline in chronological order', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripEventsFixture();

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED] as $to) {
        $this->actingAs($dispatcher, 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => $to->value])
            ->assertOk();
    }

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson("/api/v1/trips/{$trip->id}/events");

    $response->assertOk();
    $toStatuses = collect($response->json('data'))->pluck('to_status');

    expect($toStatuses->toArray())->toEqual([
        TripStatus::ASSIGNED->value,
        TripStatus::ACCEPTED->value,
        TripStatus::DRIVER_EN_ROUTE->value,
        TripStatus::DRIVER_ARRIVED->value,
    ]);
    expect($response->json('data.1.user.id'))->toBe($dispatcher->id);
});
