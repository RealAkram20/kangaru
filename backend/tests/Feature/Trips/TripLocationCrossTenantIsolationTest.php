<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripLocation;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\GpsFixtures;

/**
 * ADR-0001's mandatory isolation proof for `trip_locations`.
 *
 * This table earns its own test rather than riding on the Trips one for a
 * specific reason: it is **partitioned, and therefore carries no foreign
 * keys** — InnoDB refuses them on a partitioned table. Everywhere else in
 * the schema a cross-tenant row is caught twice, by the tenant scope and by
 * a foreign key that would not resolve. Here the scope is the only thing
 * standing between one client's movements and another's.
 *
 * A leak here is a client's vehicles' physical locations, minute by minute.
 *
 * @return array<string, mixed>
 */
function isolatedTenantWithRoute(string $label): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->forUser($driverUser)->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $vehicle = Vehicle::factory()->create();

    $trip = Trip::factory()->forTenant($tenant)->forVehicle($vehicle)->forDriver($driver)->create();

    GpsFixtures::straightLine($tenant->id, $trip->id, 6, 200.0);

    return compact('tenant', 'driverUser', 'dispatcher', 'trip');
}

it('returns 404, not 403, for another tenant\'s route', function () {
    $a = isolatedTenantWithRoute('a');
    $b = isolatedTenantWithRoute('b');

    // 403 would confirm the trip id exists somewhere, which is itself a leak.
    $this->actingAs($a['dispatcher'], 'sanctum')
        ->getJson("/api/v1/trips/{$b['trip']->id}/locations")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('refuses to record pings against another tenant\'s trip', function () {
    $a = isolatedTenantWithRoute('a');
    $b = isolatedTenantWithRoute('b');

    $this->actingAs($a['driverUser'], 'sanctum')
        ->postJson("/api/v1/trips/{$b['trip']->id}/locations", [
            'pings' => [['latitude' => 0.9, 'longitude' => 33.0, 'recorded_at' => now()->toIso8601String()]],
        ])
        ->assertStatus(404);

    // Six from the fixture and nothing more: the write never landed.
    expect(TripLocation::allTenants()->where('trip_id', $b['trip']->id)->count())->toBe(6);
});

it('hides another tenant\'s pings at the model level under TenantContext', function () {
    $a = isolatedTenantWithRoute('a');
    $b = isolatedTenantWithRoute('b');

    // Below HTTP entirely — this is TenantScope itself, which on this table
    // is the only guard, since a partitioned table can carry no foreign key.
    app(TenantContext::class)->set($a['tenant']->id);

    expect(TripLocation::count())->toBe(6);
    expect(TripLocation::where('trip_id', $b['trip']->id)->count())->toBe(0);
    expect(TripLocation::allTenants()->count())->toBe(12);
});

it('serves only this tenant\'s own route', function () {
    $a = isolatedTenantWithRoute('a');
    isolatedTenantWithRoute('b');

    $this->actingAs($a['dispatcher'], 'sanctum')
        ->getJson("/api/v1/trips/{$a['trip']->id}/locations")
        ->assertOk()
        ->assertJsonCount(6, 'data')
        // 5 hops of 200 m. Compared as a number rather than by identity:
        // a whole kilometre serialises to `1`, not `1.0`, and the point
        // here is the distance, not its JSON type.
        ->assertJsonPath('meta.gps_distance_km', fn ($value) => (float) $value === 1.0);
});
