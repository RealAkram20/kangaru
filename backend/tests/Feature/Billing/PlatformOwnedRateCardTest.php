<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Billing\Models\RateCard;
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
