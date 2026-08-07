<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Database\Factories\ZoneFactory;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Models\Zone;
use Modules\Fleet\Services\ZoneResolver;

/**
 * ADR-0021 — the geofencing engine.
 *
 * The geometry is proven on its own in `tests/Unit/BoundaryRingTest.php`.
 * What is asserted here is everything around it: whose zones a caller may
 * see, which zone wins where several overlap, and the service-area refusal
 * that ADR-0020 recorded range validation being unable to make.
 */
function zoneOps(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::OPERATIONS_MANAGER]);
}

function zoneDispatcher(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
}

const KAMPALA_LAT = 0.3476;
const KAMPALA_LNG = 32.5825;

// ── Drawing them ─────────────────────────────────────────────────────────

it('draws a zone and gives it the priority its kind implies', function () {
    $this->actingAs(zoneOps(), 'sanctum')->postJson('/api/v1/zones', [
        'name' => 'Central Kampala',
        'kind' => 'pricing',
        'boundary' => ZoneFactory::box(0.28, 32.53, 0.39, 32.64),
    ])->assertCreated()->assertJsonPath('data.priority', 50);
});

it('refuses a boundary that cannot enclose anything', function () {
    // Two points is a line. It contains nothing, so every point would fall
    // outside it and the zone would silently never match.
    $this->actingAs(zoneOps(), 'sanctum')->postJson('/api/v1/zones', [
        'name' => 'Not a zone',
        'kind' => 'pricing',
        'boundary' => [['lat' => 0.1, 'lng' => 32.1], ['lat' => 0.2, 'lng' => 32.2]],
    ])->assertStatus(422)->assertJsonValidationErrors('boundary');
});

it('insists a client zone names its client, and that the others do not', function () {
    $ops = zoneOps();
    $tenant = Tenant::factory()->create();

    // A client zone with no client would silently become a platform-wide
    // rule — the opposite of what whoever drew it meant.
    $this->actingAs($ops, 'sanctum')->postJson('/api/v1/zones', [
        'name' => 'Campus',
        'kind' => 'client',
        'boundary' => ZoneFactory::box(0.30, 32.55, 0.32, 32.57),
    ])->assertStatus(422)->assertJsonValidationErrors('tenant_id');

    // And the mirror: a service area belonging to one client is not what
    // that kind means.
    $this->actingAs($ops, 'sanctum')->postJson('/api/v1/zones', [
        'name' => 'Coverage',
        'kind' => 'service_area',
        'tenant_id' => $tenant->id,
        'boundary' => ZoneFactory::box(-0.1, 32.3, 0.6, 32.9),
    ])->assertStatus(422)->assertJsonValidationErrors('tenant_id');
});

it('needs zones.manage to draw one, which a dispatcher does not hold', function () {
    $this->actingAs(zoneDispatcher(), 'sanctum')->postJson('/api/v1/zones', [
        'name' => 'Central Kampala',
        'kind' => 'pricing',
        'boundary' => ZoneFactory::box(0.28, 32.53, 0.39, 32.64),
    ])->assertForbidden();

    // Reading is wide, though — a dispatcher who cannot see a zone cannot
    // explain why a price or a refusal happened.
    $this->actingAs(zoneDispatcher(), 'sanctum')->getJson('/api/v1/zones')->assertOk();
});

it('requires a signed-in caller', function () {
    $this->getJson('/api/v1/zones')->assertUnauthorized();
    $this->getJson('/api/v1/zones/resolve?latitude=0.3&longitude=32.5')->assertUnauthorized();
    $this->postJson('/api/v1/zones', [])->assertUnauthorized();
});

// ── Whose zones you can see ──────────────────────────────────────────────

it('shows a client the platform zones and their own, never another client\'s', function () {
    $mine = Tenant::factory()->create();
    $theirs = Tenant::factory()->create();

    Zone::factory()->create(['name' => 'Platform town']);
    Zone::factory()->forClient($mine->id)->create(['name' => 'My campus']);
    Zone::factory()->forClient($theirs->id)->create(['name' => 'Their campus']);

    $admin = User::factory()->create(['tenant_id' => $mine->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $names = collect($this->actingAs($admin, 'sanctum')->getJson('/api/v1/zones')->assertOk()->json('data'))
        ->pluck('name');

    // A platform zone must be visible to every client — it is what prices
    // their trips. Another client's must never be.
    expect($names)->toContain('Platform town');
    expect($names)->toContain('My campus');
    expect($names)->not->toContain('Their campus');
});

// ── Resolution ───────────────────────────────────────────────────────────

it('returns the narrowest zone first where several overlap', function () {
    $tenant = Tenant::factory()->create();

    Zone::factory()->serviceArea()->create();
    Zone::factory()->create(['name' => 'Central Kampala']);
    Zone::factory()->forClient($tenant->id)->create([
        'name' => 'Client campus',
        'boundary' => ZoneFactory::box(0.34, 32.57, 0.36, 32.59),
    ]);

    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $names = collect($this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/zones/resolve?latitude='.KAMPALA_LAT.'&longitude='.KAMPALA_LNG)
        ->assertOk()->json('data'))->pluck('name');

    // Zones nest by design; the caller wants the most specific answer
    // first, and nobody should have to know the priority numbers to get it.
    expect($names->first())->toBe('Client campus');
    expect($names->last())->toBe('Greater Kampala');
});

it('ignores a retired zone', function () {
    Zone::factory()->inactive()->create(['name' => 'Old town']);

    $rows = $this->actingAs(zoneDispatcher(), 'sanctum')
        ->getJson('/api/v1/zones/resolve?latitude='.KAMPALA_LAT.'&longitude='.KAMPALA_LNG)
        ->assertOk()->json('data');

    expect($rows)->toBeEmpty();
});

it('reports the pricing zone separately from the zones containing the point', function () {
    Zone::factory()->serviceArea()->create();
    $pricing = Zone::factory()->create(['name' => 'Central Kampala']);

    $meta = $this->actingAs(zoneDispatcher(), 'sanctum')
        ->getJson('/api/v1/zones/resolve?latitude='.KAMPALA_LAT.'&longitude='.KAMPALA_LNG)
        ->assertOk()->json('meta');

    // A service area answers "may we take this job"; a pricing zone answers
    // "what does it cost". They are different questions.
    expect($meta['within_service_area'])->toBeTrue();
    expect($meta['pricing_zone_id'])->toBe($pricing->id);
});

// ── The service-area refusal ─────────────────────────────────────────────

it('accepts an order anywhere when no service area has been drawn', function () {
    // Coverage is opt-in. An operator who has not mapped theirs must not
    // have every order refused, and a rule that switched itself on when
    // somebody saved their first zone would be worse than none.
    expect(app(ZoneResolver::class)->withinServiceArea(51.5, -0.12))->toBeTrue();
});

it('refuses a pickup outside the service area', function () {
    Zone::factory()->serviceArea()->create();

    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Grace Amongin',
        'contact_phone' => '+256700123456',
        'pickup_location' => 'Somewhere far away',
        'dropoff_location' => 'Entebbe Airport',
        'pickup_latitude' => 51.5074,
        'pickup_longitude' => -0.1278,
    ])->assertStatus(422)->assertJsonValidationErrors('pickup_latitude');
});

it('catches the swapped Kampala pair that range validation provably cannot', function () {
    Zone::factory()->serviceArea()->create();

    // ADR-0020 records this exactly: 0.3476 N / 32.5825 E swapped is
    // 32.5825 N / 0.3476 E — off the coast of Ghana, with *both values*
    // inside their valid ranges. No `between:` rule can see it. A service
    // area can, because Ghana is not in it.
    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Grace Amongin',
        'contact_phone' => '+256700123456',
        'pickup_location' => 'Acacia Mall',
        'dropoff_location' => 'Entebbe Airport',
        'pickup_latitude' => KAMPALA_LNG,
        'pickup_longitude' => KAMPALA_LAT,
    ])->assertStatus(422)->assertJsonValidationErrors('pickup_latitude');
});

it('still accepts a correct Kampala pickup', function () {
    Zone::factory()->serviceArea()->create();

    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Grace Amongin',
        'contact_phone' => '+256700123456',
        'pickup_location' => 'Acacia Mall',
        'dropoff_location' => 'Entebbe Airport',
        'pickup_latitude' => KAMPALA_LAT,
        'pickup_longitude' => KAMPALA_LNG,
    ])->assertCreated();
});

it('still accepts an order with no coordinates at all', function () {
    Zone::factory()->serviceArea()->create();

    // A phone order has none, and the guard must stay silent rather than
    // refusing everything it cannot check.
    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Grace Amongin',
        'contact_phone' => '+256700123456',
        'pickup_location' => 'Acacia Mall',
        'dropoff_location' => 'Entebbe Airport',
    ])->assertCreated();
});

it('retires a zone without destroying what it priced', function () {
    $zone = Zone::factory()->create();

    $this->actingAs(zoneOps(), 'sanctum')
        ->deleteJson("/api/v1/zones/{$zone->id}")
        ->assertNoContent();

    // Soft-deleted: an invoice raised last month recorded the zone it was
    // priced in, and a hard delete leaves that reference pointing nowhere.
    expect(Zone::withTrashed()->find($zone->id))->not->toBeNull();
    expect(app(ZoneResolver::class)->at(KAMPALA_LAT, KAMPALA_LNG))->toBeEmpty();
});

it('names the kind on the zone, so a report can group by it', function () {
    Zone::factory()->serviceArea()->create();

    $row = $this->actingAs(zoneDispatcher(), 'sanctum')
        ->getJson('/api/v1/zones')->assertOk()->json('data.0');

    expect($row['kind'])->toBe(ZoneKind::SERVICE_AREA->value);
});
