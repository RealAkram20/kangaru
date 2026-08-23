<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Services\BookingService;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md-mandated and non-skippable — but **repointed** by ADR-0005, not
 * removed.
 *
 * It used to prove that one tenant could not see another's vehicles. That
 * is no longer true, and no longer should be: Shanitah operates one fleet
 * and every dispatcher works the same pool. A corporate client owns no
 * vehicle at all.
 *
 * So the file now proves the two things that replaced it:
 *
 * 1. **The fleet is deliberately shared.** Asserted explicitly rather than
 *    left implicit, so re-scoping vehicles to a tenant by accident — a
 *    stray `BelongsToTenant`, a `tenant_id` creeping back — fails here
 *    loudly instead of quietly breaking dispatch.
 * 2. **What the client actually owns stays isolated.** A shared fleet means
 *    a leak can no longer be caught by "did another tenant's vehicle
 *    appear". It has to be caught on the rows carrying a client's movements
 *    — their trips. That is the assertion that matters now.
 *
 * @return array<string, mixed>
 */
function seedTwoTenantsSharingTheFleet(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    // One pool. Neither vehicle belongs to anybody.
    $vehicleA = Vehicle::factory()->van()->create();
    $vehicleB = Vehicle::factory()->create();

    $userA = User::factory()->create(['tenant_id' => $tenantA->id, 'role' => UserRole::FLEET_OWNER]);
    $userB = User::factory()->create(['tenant_id' => $tenantB->id, 'role' => UserRole::FLEET_OWNER]);

    // The fleet that owns the pool. `VehicleFactory` puts both vehicles on
    // Shanitah; since ADR-0055 the register is Shanitah's, and reading it is
    // a fleet act rather than a client's.
    $fleetUser = User::factory()->create(['role' => UserRole::FLEET_OWNER]);

    return compact('tenantA', 'tenantB', 'vehicleA', 'vehicleB', 'userA', 'userB', 'fleetUser');
}

it('shows a fleet its whole pool, undivided by which client it is serving', function () {
    ['vehicleA' => $vehicleA, 'vehicleB' => $vehicleB, 'fleetUser' => $fleetUser] = seedTwoTenantsSharingTheFleet();

    $ids = collect(
        $this->actingAs($fleetUser, 'sanctum')->getJson('/api/v1/vehicles')->assertOk()->json('data')
    )->pluck('id');

    // Both, deliberately (ADR-0005). If this ever fails it means the fleet
    // has been re-scoped to tenants, and dispatch will have quietly stopped
    // being able to reach most of the pool.
    expect($ids)->toContain($vehicleA->id);
    expect($ids)->toContain($vehicleB->id);
});

/*
 * The same repointing as `DriverCrossTenantIsolationTest`, for the same
 * reason and with the same history — see the long note there.
 *
 * In short: this acted as `$userA`, whose `tenant_id` makes it an
 * `access_level: client` account, so the assertion had silently become *"a
 * corporate client reads the operator's whole vehicle register"*. ADR-0005
 * said the pool is not divided per client. It never said a client may read it.
 */
it('shows a client none of the pool, which owns no vehicle to begin with', function () {
    ['vehicleA' => $vehicleA, 'userA' => $userA] = seedTwoTenantsSharingTheFleet();

    $body = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/vehicles')->assertOk()->json('data');

    expect($body)->toHaveCount(0)
        ->and(collect($body)->pluck('id'))->not->toContain($vehicleA->id);
});

it('lets any tenant open any vehicle in the pool', function () {
    ['vehicleB' => $vehicleB, 'userA' => $userA] = seedTwoTenantsSharingTheFleet();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/vehicles/{$vehicleB->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $vehicleB->id);
});

it('no longer hides a vehicle at the model level', function () {
    ['tenantA' => $tenantA, 'vehicleB' => $vehicleB] = seedTwoTenantsSharingTheFleet();

    app(TenantContext::class)->set($tenantA->id);

    // Vehicle has no BelongsToTenant since ADR-0005, so TenantScope does
    // not apply. Asserted so that adding it back is a failing test rather
    // than a silent halving of the fleet.
    expect(Vehicle::find($vehicleB->id))->not->toBeNull();
});

it('still keeps each client\'s trips to themselves, which is where the isolation moved', function () {
    ['tenantA' => $tenantA, 'tenantB' => $tenantB, 'vehicleA' => $vehicleA, 'vehicleB' => $vehicleB]
        = seedTwoTenantsSharingTheFleet();

    $tripFor = function (Tenant $tenant, Vehicle $vehicle) {
        app(TenantContext::class)->set($tenant->id);

        $requester = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
        $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

        $booking = app(BookingService::class)->create([
            'tenant_id' => $tenant->id,
            'passenger_name' => 'Passenger',
            'passenger_phone' => '+256700000000',
            'passenger_count' => 1,
            'origin' => 'Kampala',
            'destination' => 'Entebbe',
        ], $requester);

        app(BookingService::class)->approve($booking, $requester);

        return [
            app(DispatchService::class)->assign(
                $booking->refresh(),
                $vehicle->id,
                Driver::factory()->create()->id,
                $dispatcher,
            ),
            $dispatcher,
        ];
    };

    [$tripA, $dispatcherA] = $tripFor($tenantA, $vehicleA);
    [$tripB] = $tripFor($tenantB, $vehicleB);

    // Two tenants, one fleet, and the vehicles are visible to both — but the
    // journeys are not. This is the assertion that carries the weight ADR-0001
    // put on the vehicle test before the fleet was shared.
    app(TenantContext::class)->set($tenantA->id);

    $ids = array_column(
        $this->actingAs($dispatcherA, 'sanctum')->getJson('/api/v1/trips')->assertOk()->json('data'),
        'id',
    );

    expect($ids)->toContain($tripA->id);
    expect($ids)->not->toContain($tripB->id);

    // And at the model level, which is where a forgotten scope would show.
    expect(Trip::find($tripB->id))->toBeNull();
});
