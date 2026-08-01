<?php

use App\Exceptions\FinancialRecordImmutableException;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Services\RateCardService;
use Tests\Support\BillingFixtures;

/**
 * @return array<string, mixed>
 */
function rateCardPayload(array $overrides = []): array
{
    return [
        'name' => 'Corporate 2026',
        'is_default' => true,
        'version' => [
            'effective_from' => '2026-01-01',
            'rounding_mode' => 'half_up',
            'free_waiting_minutes' => 10,
            'rates' => [
                ['vehicle_category' => 'sedan', 'base_fare_minor' => 5_000, 'per_km_minor' => 500,
                    'per_waiting_minute_minor' => 200, 'minimum_charge_minor' => 10_000],
                ['vehicle_category' => 'van', 'base_fare_minor' => 8_000, 'per_km_minor' => 800,
                    'per_waiting_minute_minor' => 300, 'minimum_charge_minor' => 15_000],
            ],
            ...($overrides['version'] ?? []),
        ],
        ...array_diff_key($overrides, ['version' => null]),
    ];
}

it('creates a rate card together with its first priced version', function () {
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $response = $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/rate-cards', rateCardPayload(['is_default' => false]));

    $response->assertStatus(201)
        ->assertJsonPath('data.name', 'Corporate 2026')
        ->assertJsonPath('data.versions.0.version', 1)
        ->assertJsonPath('data.versions.0.rounding_mode', 'half_up')
        // Not yet used by any invoice, so still supersedable.
        ->assertJsonPath('data.versions.0.is_locked', false);

    expect($response->json('data.versions.0.rates'))->toHaveCount(2);
});

it('refuses to create a rate card with no priced rates', function () {
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    // A version that prices nothing can never invoice anything, and if it
    // became the tenant's default every trip would fail at billing time.
    $payload = rateCardPayload(['name' => 'Empty', 'version' => ['rates' => []]]);

    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/rate-cards', $payload)
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('refuses a version that prices one vehicle category twice', function () {
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $payload = rateCardPayload(['name' => 'Duplicated', 'version' => ['rates' => [
        ['vehicle_category' => 'sedan', 'base_fare_minor' => 5_000],
        ['vehicle_category' => 'sedan', 'base_fare_minor' => 9_000],
    ]]]);

    // Two rows for one category means the pricing engine would silently
    // take whichever came back first — a rate card that does not mean what
    // it says.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/rate-cards', $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('version.rates.1.vehicle_category');
});

it('refuses a maximum charge below the minimum charge', function () {
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $payload = rateCardPayload(['name' => 'Impossible', 'version' => ['rates' => [
        ['vehicle_category' => 'sedan', 'minimum_charge_minor' => 20_000, 'maximum_charge_minor' => 10_000],
    ]]]);

    // The engine checks the minimum first, so the maximum would never
    // apply and the card would quietly not mean what it says.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/rate-cards', $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('version.rates.0.maximum_charge_minor');
});

it('refuses a night window with only one edge', function () {
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $payload = rateCardPayload(['name' => 'Half a window', 'version' => ['night_starts_at' => '22:00']]);

    // A start with no end is a window that never closes: every trip after
    // 22:00 would be billed at the night rate forever.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/rate-cards', $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('version.night_ends_at');
});

it('supersedes prices with a new version and leaves the old one intact', function () {
    ['finance' => $finance, 'card' => $card, 'version' => $original] = BillingFixtures::tenantWithRateCard();

    $response = $this->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->id}/versions", [
            'effective_from' => '2026-09-01',
            'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 7_500, 'per_km_minor' => 600]],
        ]);

    $response->assertStatus(201)->assertJsonPath('data.version', 2);

    // AGENTS.md: "Editing creates a new version; historical invoices keep
    // their version reference." Version 1 is untouched, prices and all.
    $reloaded = $original->fresh()->load('rates');
    expect($reloaded->version)->toBe(1);
    expect($reloaded->rateFor('sedan')->baseFare()->getMinorAmount()->toInt())->toBe(5_000);
    expect($card->versions()->count())->toBe(2);
});

it('refuses every attempt to edit a rate card version or its rates', function () {
    ['version' => $version] = BillingFixtures::tenantWithRateCard();

    // Stricter than "immutable once used": immutable from creation. A
    // version that can be edited right up until its first invoice has a
    // window in which two people read different prices off the same version
    // number — which is precisely the argument versioning exists to end.
    expect(fn () => $version->update(['free_waiting_minutes' => 999]))
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $version->delete())
        ->toThrow(FinancialRecordImmutableException::class);

    $rate = $version->rates->first();
    expect(fn () => $rate->update(['per_km_minor' => 1]))
        ->toThrow(FinancialRecordImmutableException::class);
    expect(fn () => $rate->delete())
        ->toThrow(FinancialRecordImmutableException::class);

    expect($version->fresh()->free_waiting_minutes)->toBe(10);
});

it('still permits the one update that seals a version as used', function () {
    ['version' => $version] = BillingFixtures::tenantWithRateCard();

    // The single exception carved out of the rule above, and the only
    // reason RateCardVersion::updating() is not an unconditional throw.
    $version->lock();
    expect($version->fresh()->isLocked())->toBeTrue();

    // Idempotent: sealing an already-sealed version is a no-op rather than
    // a second write that the immutability guard would then reject.
    $version->lock();
    expect($version->fresh()->isLocked())->toBeTrue();
});

it('moves the default flag to exactly one card at a time', function () {
    ['finance' => $finance, 'card' => $original] = BillingFixtures::tenantWithRateCard();

    expect($original->fresh()->is_default)->toBeTrue();

    $second = app(RateCardService::class)->create(rateCardPayload([
        'name' => 'Second card', 'is_default' => false,
    ]), $finance);

    $this->actingAs($finance, 'sanctum')
        ->putJson("/api/v1/rate-cards/{$second->id}/default")
        ->assertOk()
        ->assertJsonPath('data.is_default', true);

    // MySQL cannot express "at most one true per tenant", so the demotion
    // and promotion share a transaction. This is the assertion that the
    // transaction actually does both.
    expect($original->fresh()->is_default)->toBeFalse();
    expect(RateCard::where('is_default', true)->count())->toBe(1);
});

it('numbers versions per card, so two cards both start at 1', function () {
    ['finance' => $finance, 'card' => $first] = BillingFixtures::tenantWithRateCard();

    $second = app(RateCardService::class)->create(rateCardPayload([
        'name' => 'Another card', 'is_default' => false,
    ]), $finance);

    expect($first->versions()->reorder()->orderBy('version')->pluck('version')->all())->toBe([1]);
    expect($second->versions()->reorder()->orderBy('version')->pluck('version')->all())->toBe([1]);

    app(RateCardService::class)->addVersion($first, [
        'effective_from' => '2026-10-01',
        'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 1_000]],
    ], $finance);

    expect(RateCardVersion::where('rate_card_id', $first->id)->max('version'))->toBe(2);
    expect(RateCardVersion::where('rate_card_id', $second->id)->max('version'))->toBe(1);
});

it('exposes no route that could edit or delete a rate card', function () {
    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    // The absence is the design, not an oversight: prices change by adding
    // a version. Asserted so that adding `update`/`destroy` to the
    // apiResource later is a deliberate act with a failing test attached.
    //
    // 405, not 404: the URI exists for GET, so the router reports that the
    // *method* is not allowed. Either would prove the route is absent; 405
    // is what actually happens and is the honest thing to assert.
    $this->actingAs($finance, 'sanctum')
        ->patchJson("/api/v1/rate-cards/{$card->id}", ['name' => 'Renamed'])
        ->assertStatus(405);

    $this->actingAs($finance, 'sanctum')
        ->deleteJson("/api/v1/rate-cards/{$card->id}")
        ->assertStatus(405);

    expect($card->fresh()->name)->toBe('Standard');
});
