<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md-mandated, non-skippable: proves ADR-0001 tenant isolation holds
 * for bookings, mirroring CompanyCrossTenantIsolationTest.
 */
function seedTwoTenantsWithBookings(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $bookingA = Booking::factory()->forTenant($tenantA)->create(['destination' => 'Entebbe']);
    $bookingB = Booking::factory()->forTenant($tenantB)->create(['destination' => 'Mbale']);

    $userA = User::factory()->create(['tenant_id' => $tenantA->id, 'role' => UserRole::DISPATCHER]);

    return compact('tenantA', 'tenantB', 'bookingA', 'bookingB', 'userA');
}

it('excludes another tenant\'s booking from the index listing', function () {
    ['bookingA' => $bookingA, 'bookingB' => $bookingB, 'userA' => $userA] = seedTwoTenantsWithBookings();

    $response = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/bookings');

    $ids = collect($response->json('data'))->pluck('id');

    $response->assertOk();
    expect($ids)->toContain($bookingA->id);
    expect($ids)->not->toContain($bookingB->id);
});

it('returns 404, not 403, when fetching another tenant\'s booking by id', function () {
    ['bookingB' => $bookingB, 'userA' => $userA] = seedTwoTenantsWithBookings();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/bookings/{$bookingB->id}")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('hides another tenant\'s booking at the model level under TenantContext', function () {
    ['tenantA' => $tenantA, 'bookingB' => $bookingB] = seedTwoTenantsWithBookings();

    app(TenantContext::class)->set($tenantA->id);

    expect(Booking::find($bookingB->id))->toBeNull();
});

it('allows fetching your own tenant\'s booking', function () {
    ['bookingA' => $bookingA, 'userA' => $userA] = seedTwoTenantsWithBookings();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/bookings/{$bookingA->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $bookingA->id);
});

it('returns 404, not 403, when dispatching another tenant\'s booking', function () {
    ['tenantA' => $tenantA, 'bookingB' => $bookingB, 'userA' => $userA] = seedTwoTenantsWithBookings();

    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create();

    $this->actingAs($userA, 'sanctum')
        ->postJson("/api/v1/bookings/{$bookingB->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('dispatches any vehicle in the platform pool, whichever client asked', function () {
    ['bookingA' => $bookingA, 'userA' => $userA] = seedTwoTenantsWithBookings();

    // Since ADR-0005 there is no "another tenant's vehicle" — Shanitah
    // operates one fleet and a corporate client owns none of it. What this
    // used to assert has stopped being true on purpose, so it now asserts
    // the replacement: any active vehicle in the pool is dispatchable
    // against any client's booking.
    $this->actingAs($userA, 'sanctum')
        ->postJson("/api/v1/bookings/{$bookingA->id}/assignment", [
            'vehicle_id' => Vehicle::factory()->create()->id,
            'driver_id' => Driver::factory()->create()->id,
        ])
        ->assertStatus(201);
});

it('still refuses a vehicle that is not on the road', function () {
    ['bookingA' => $bookingA, 'userA' => $userA] = seedTwoTenantsWithBookings();

    // The check that survived the fleet move. Tenancy is no longer the
    // reason a vehicle can be refused; being in the workshop still is.
    $this->actingAs($userA, 'sanctum')
        ->postJson("/api/v1/bookings/{$bookingA->id}/assignment", [
            'vehicle_id' => Vehicle::factory()->create(['status' => 'maintenance'])->id,
            'driver_id' => Driver::factory()->create()->id,
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});
