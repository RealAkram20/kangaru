<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Trips\Models\Trip;

/**
 * `from`/`to` on /trips bound `created_at` — the axis the list is ordered
 * by, present on every trip. "Trips *started* in a range" is the trip
 * report's question; a `started_at` filter here would silently drop every
 * trip still awaiting its driver.
 */
function seedTripDateFilterDispatcher(): array
{
    $tenant = Tenant::factory()->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    return [$tenant, $dispatcher];
}

it('narrows the list to trips raised inside the range', function () {
    [$tenant, $dispatcher] = seedTripDateFilterDispatcher();

    $inside = Trip::factory()->forTenant($tenant)->create(['created_at' => '2026-08-10 09:00:00']);
    $outside = Trip::factory()->forTenant($tenant)->create(['created_at' => '2026-09-15 09:00:00']);

    $ids = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/trips?from=2026-08-01&to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($inside->id);
    expect($ids)->not->toContain($outside->id);
});

it('includes the whole of the day `to` names, not just its midnight', function () {
    [$tenant, $dispatcher] = seedTripDateFilterDispatcher();

    $evening = Trip::factory()->forTenant($tenant)->create(['created_at' => '2026-08-31 18:00:00']);

    $ids = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/trips?from=2026-08-01&to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($evening->id);
});

it('accepts an open-ended range', function () {
    [$tenant, $dispatcher] = seedTripDateFilterDispatcher();

    $late = Trip::factory()->forTenant($tenant)->create(['created_at' => '2026-09-15 09:00:00']);
    $early = Trip::factory()->forTenant($tenant)->create(['created_at' => '2026-08-10 09:00:00']);

    $fromOnly = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/trips?from=2026-09-01')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($fromOnly)->toContain($late->id);
    expect($fromOnly)->not->toContain($early->id);

    $toOnly = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/trips?to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($toOnly)->toContain($early->id);
    expect($toOnly)->not->toContain($late->id);
});

it('rejects a malformed date with a 422', function () {
    [, $dispatcher] = seedTripDateFilterDispatcher();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/trips?from=last-tuesday')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('rejects a range that ends before it starts with a 422', function () {
    [, $dispatcher] = seedTripDateFilterDispatcher();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/trips?from=2026-08-31&to=2026-08-01')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});
