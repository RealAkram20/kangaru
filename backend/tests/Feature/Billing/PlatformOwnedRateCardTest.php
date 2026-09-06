<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Vehicles\Models\Vehicle;

/**
 * A rate card the platform owns rather than a client — `tenant_id` null, which
 * the public walk-in tariff is (ADR-0026 §1).
 *
 * These cards are the case tenant scoping is least likely to be exercised
 * against, and one bug lived there undisturbed: `RateCardService` counted a
 * card's existing versions through the plain relation, which carries the
 * global `TenantScope`. That scope **fails closed** — `1 = 0` — when no tenant
 * is bound, and platform staff have no tenant of their own. So the count came
 * back empty, the next version number was always 1, and the insert died on the
 * `(rate_card_id, version)` unique index.
 *
 * The public tariff therefore could not be given a second version through the
 * API at all: a 500, every time, for the only card this applies to. It went
 * unnoticed because that card had exactly one version and nobody had needed a
 * second until a maximum charge had to be set on it.
 */

/** @return array{0: User, 1: RateCard} */
function platformTariff(): array
{
    // Platform staff: `tenant_id` null is what `forActor()` keys on.
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $card = RateCard::query()->create([
        'tenant_id' => null,
        'name' => 'Public tariff',
        'status' => 'active',
        'is_default' => true,
    ]);

    RateCardVersion::query()->create([
        'tenant_id' => null,
        'rate_card_id' => $card->getKey(),
        'version' => 1,
        'effective_from' => '2026-01-01',
        'currency' => 'UGX',
        'rounding_mode' => 'half_up',
        'free_waiting_minutes' => 3,
        'night_multiplier_bp' => 10_000,
        'created_by_user_id' => $admin->getKey(),
    ]);

    return [$admin, $card];
}

it('adds a second version to a platform-owned rate card', function () {
    [$admin, $card] = platformTariff();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->getKey()}/versions", [
            'effective_from' => '2026-08-15',
            'rounding_mode' => 'half_up',
            'free_waiting_minutes' => 3,
            'rates' => [[
                'vehicle_category' => 'sedan',
                'base_fare_minor' => 5_000,
                'per_km_minor' => 2_200,
                'per_waiting_minute_minor' => 500,
                'minimum_charge_minor' => 8_000,
                'maximum_charge_minor' => 1_500_000,
            ]],
        ])
        ->assertStatus(201)
        // The number is the point. Before the fix this was 1 again, and the
        // unique index turned it into a 500.
        ->assertJsonPath('data.version', 2);

    expect(
        RateCardVersion::query()->allTenants()->where('rate_card_id', $card->getKey())->count()
    )->toBe(2);
});

it('keeps counting versions correctly on a third', function () {
    [$admin, $card] = platformTariff();

    foreach (['2026-08-15' => 2, '2026-09-01' => 3] as $from => $expected) {
        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/rate-cards/{$card->getKey()}/versions", [
                'effective_from' => $from,
                'rounding_mode' => 'half_up',
                'free_waiting_minutes' => 3,
                'rates' => [[
                    'vehicle_category' => 'sedan',
                    'base_fare_minor' => 5_000,
                    'per_km_minor' => 2_200,
                    'per_waiting_minute_minor' => 500,
                    'minimum_charge_minor' => 8_000,
                ]],
            ])
            ->assertStatus(201)
            ->assertJsonPath('data.version', $expected);
    }
});

it('prices the categories the walk-in tariff actually uses', function () {
    // `boda` and `tricycle` were absent from `Vehicle::CATEGORIES` while the
    // seeded public tariff priced both and a vehicle in the fleet was already
    // recorded as a boda — the rows went in through seeders, which skips this
    // validation. The visible symptom was a 422 refusing two of the six
    // categories the tariff already had, on any attempt to version it.
    expect(Vehicle::CATEGORIES)->toContain('boda')
        ->and(Vehicle::CATEGORIES)->toContain('tricycle');

    [$admin, $card] = platformTariff();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->getKey()}/versions", [
            'effective_from' => '2026-08-15',
            'rounding_mode' => 'half_up',
            'free_waiting_minutes' => 3,
            'rates' => [
                ['vehicle_category' => 'boda', 'base_fare_minor' => 2_000, 'per_km_minor' => 1_000,
                    'per_waiting_minute_minor' => 200, 'minimum_charge_minor' => 3_000,
                    'maximum_charge_minor' => 150_000],
                ['vehicle_category' => 'tricycle', 'base_fare_minor' => 3_000, 'per_km_minor' => 1_400,
                    'per_waiting_minute_minor' => 300, 'minimum_charge_minor' => 5_000,
                    'maximum_charge_minor' => 200_000],
            ],
        ])
        ->assertStatus(201);
});

/**
 * The other half of the same bug, and the one a human actually saw.
 *
 * `RateCardService` had been taught `forActor()` on every write path and
 * `BelongsToTenant::resolveRouteBinding()` had been made actor-aware, so a
 * platform user could open a rate card by id and version it. The **listing**
 * still ran a plain `RateCard::query()`, which carries the fail-closed
 * `TenantScope` — so the console's Rate Cards page showed "No rate cards yet"
 * to Super Admin and Finance, the two roles that own pricing, on a database
 * holding three cards including the live public tariff.
 *
 * `resolveRouteBinding()`'s docblock had already named this leftover in
 * advance: *"that is the shape of the Super Admin's empty platform today — the
 * listing was only half of it."*
 */
it('lists rate cards to platform staff, who have no tenant of their own', function () {
    [$admin, $card] = platformTariff();

    // The shared helper builds a version with no rates, which is enough for the
    // version-numbering cases above but would make the rates assertion below
    // pass vacuously. One priced category, added here rather than in the
    // helper so the three cases that came first are untouched.
    $version = RateCardVersion::allTenants()->where('rate_card_id', $card->getKey())->firstOrFail();

    RateCardRate::query()->create([
        'tenant_id' => null,
        'rate_card_version_id' => $version->getKey(),
        'vehicle_category' => 'boda',
        'base_fare_minor' => 2_000,
        'per_km_minor' => 1_000,
        'per_waiting_minute_minor' => 200,
        'minimum_charge_minor' => 3_000,
    ]);

    $response = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/rate-cards')
        ->assertOk();

    // Drop `forActor()` from the controller and this is 0 — the empty screen.
    expect($response->json('data'))->toHaveCount(1);
    $response->assertJsonPath('data.0.id', $card->getKey());

    // **And the versions have to come with it.** `RateCardVersion` carries
    // `BelongsToTenant` too, so the eager load runs its own query under its own
    // fail-closed scope — scoping only the parent produced a list of cards each
    // reading "This card has no versions and cannot price a trip", on a tariff
    // holding two. That is worse than the empty list it replaced: it is a
    // specific, false, alarming claim about a card that is pricing live trips.
    expect($response->json('data.0.versions'))->toHaveCount(1);

    // `RateCardRate` extends `PricedRate`, which is where the trait actually
    // sits — so the model itself greps clean while being fully scoped. Fixing
    // only `versions` moved the symptom to "a version priced at nothing",
    // which looks like data rather than like a bug.
    expect($response->json('data.0.versions.0.rates'))->not->toBeEmpty();
});

it('still shows a tenant user only their own cards', function () {
    // The guard on the fix. `forActor()` answers *whose* rows and must change
    // nothing for an actor who has a tenant — widening it to every card would
    // turn a scoping fix into the cross-tenant leak ADR-0001 calls the worst
    // possible bug.
    [, $platformCard] = platformTariff();

    $tenant = Tenant::query()->first() ?? Tenant::factory()->create();

    $ownCard = RateCard::query()->create([
        'tenant_id' => $tenant->getKey(),
        'name' => 'Client tariff',
        'status' => 'active',
        'is_default' => true,
    ]);

    $corporate = User::factory()->create([
        'tenant_id' => $tenant->getKey(),
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $ids = collect(
        $this->actingAs($corporate, 'sanctum')
            ->getJson('/api/v1/rate-cards')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($ownCard->getKey())
        ->and($ids)->not->toContain($platformCard->getKey());
});
