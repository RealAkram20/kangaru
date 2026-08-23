<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Modules\Administration\Services\SettingsService;
use Modules\Clients\Models\ClientPlace;

/**
 * Drawing a circuit that is still being dragged (ADR-0045 §7).
 *
 * The three things worth pinning here are all about **not inventing a
 * line**: that the waypoints reach the provider in the officer's order and
 * not a shorter one, that routing being off is a null rather than a
 * straight line, and that another client's ATM cannot be smuggled into the
 * shape.
 */

/**
 * @return array{tenant: Tenant, admin: User}
 */
function previewFixture(): array
{
    $tenant = Tenant::factory()->create(['name' => 'Centenary Bank']);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    return compact('tenant', 'admin');
}

function enableFreeRouting(): void
{
    app(SettingsService::class)->setGroup('maps', [
        'routing_enabled' => true,
        'routing_provider' => 'osrm',
        'osrm_base_url' => 'https://osrm.test',
    ]);
}

it('sends every stop to the provider, in the order the officer put them in', function () {
    ['tenant' => $tenant, 'admin' => $admin] = previewFixture();
    enableFreeRouting();

    $a = ClientPlace::factory()->forTenant($tenant)->at(0.3136, 32.5811)->create(['name' => 'Head Office']);
    $b = ClientPlace::factory()->forTenant($tenant)->at(0.3350, 32.6100)->create(['name' => 'Nakawa ATM']);
    $c = ClientPlace::factory()->forTenant($tenant)->at(0.3300, 32.5700)->create(['name' => 'Wandegeya ATM']);

    Http::fake([
        'osrm.test/*' => Http::response([
            'code' => 'Ok',
            'routes' => [['geometry' => 'yz~vAqf~kG', 'distance' => 34200, 'duration' => 6600]],
        ]),
    ]);

    $response = $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$c->id, $a->id, $b->id]])
        ->assertOk();

    expect($response->json('data.distance_km'))->toBe(34.2);
    expect($response->json('data.duration_seconds'))->toBe(6600);
    expect($response->json('data.is_estimate'))->toBeTrue();

    Http::assertSent(function ($request) {
        // OSRM is `lng,lat` — the opposite of everything else here — and all
        // three points must be on the URL in the order sent. A provider that
        // received two of three would draw a circuit that misses an ATM.
        expect($request->url())->toContain('32.57,0.33;32.5811,0.3136;32.61,0.335');

        // No optimisation flag anywhere near it: ADR-0045 §7 refuses to let
        // a provider reorder a cash run to save kilometres.
        expect($request->url())->not->toContain('optimize');

        return true;
    });
});

it('answers null rather than a straight line when routing is switched off', function () {
    ['tenant' => $tenant, 'admin' => $admin] = previewFixture();

    $a = ClientPlace::factory()->forTenant($tenant)->create();
    $b = ClientPlace::factory()->forTenant($tenant)->create();

    // Routing is off by default (ADR-0031 §2) and this asserts the default.
    $response = $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$a->id, $b->id]])
        ->assertOk();

    // Null, not a shape. The builder draws pins and an em dash; anything
    // else here would be a road the platform did not measure.
    expect($response->json('data'))->toBeNull();
});

it('answers null when the provider declines, rather than half a circuit', function () {
    ['tenant' => $tenant, 'admin' => $admin] = previewFixture();
    enableFreeRouting();

    $a = ClientPlace::factory()->forTenant($tenant)->create();
    $b = ClientPlace::factory()->forTenant($tenant)->create();

    Http::fake(['osrm.test/*' => Http::response(['code' => 'NoRoute'])]);

    $response = $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$a->id, $b->id]])
        ->assertOk();

    expect($response->json('data'))->toBeNull();
});

it('refuses to draw a circuit through another client place', function () {
    ['tenant' => $tenant, 'admin' => $admin] = previewFixture();
    enableFreeRouting();

    $mine = ClientPlace::factory()->forTenant($tenant)->create();
    $theirs = ClientPlace::factory()->create();

    Http::fake(['osrm.test/*' => Http::response(['code' => 'Ok', 'routes' => [['geometry' => 'x', 'distance' => 1, 'duration' => 1]]])]);

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$mine->id, $theirs->id]])
        ->assertStatus(422)
        ->assertJsonPath('code', 'UNKNOWN_CLIENT_PLACE')
        ->assertJsonPath('errors.place_ids', [(string) $theirs->id]);

    // Not merely refused in the response — never asked. A drawn line for a
    // stranger's coordinates is a cross-tenant read that happens to be
    // shaped like a road.
    Http::assertNothingSent();
});

it('will not draw a journey of one place', function () {
    ['tenant' => $tenant, 'admin' => $admin] = previewFixture();

    $a = ClientPlace::factory()->forTenant($tenant)->create();

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$a->id]])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('draws the same place twice when a circuit returns to where it started', function () {
    ['tenant' => $tenant, 'admin' => $admin] = previewFixture();
    enableFreeRouting();

    $office = ClientPlace::factory()->forTenant($tenant)->at(0.3136, 32.5811)->create();
    $atm = ClientPlace::factory()->forTenant($tenant)->at(0.3350, 32.6100)->create();

    Http::fake([
        'osrm.test/*' => Http::response([
            'code' => 'Ok',
            'routes' => [['geometry' => 'yz~vAqf~kG', 'distance' => 20000, 'duration' => 3600]],
        ]),
    ]);

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$office->id, $atm->id, $office->id]])
        ->assertOk();

    Http::assertSent(function ($request) {
        // Head office at both ends is the ordinary shape of a cash run, and
        // a `keyBy` that deduplicated it would quietly drop the leg home.
        expect($request->url())->toContain('32.5811,0.3136;32.61,0.335;32.5811,0.3136');

        return true;
    });
});

it('is refused to an employee who may not build routes', function () {
    ['tenant' => $tenant] = previewFixture();

    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $a = ClientPlace::factory()->forTenant($tenant)->create();
    $b = ClientPlace::factory()->forTenant($tenant)->create();

    $this->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/routes/preview', ['place_ids' => [$a->id, $b->id]])
        ->assertForbidden();
});
