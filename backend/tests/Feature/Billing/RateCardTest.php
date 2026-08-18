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

it('exposes no route that could delete a rate card, or reprice one', function () {
    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    /*
     * **This case used to assert that PATCH was 405 too, and the owner has
     * since asked for card editing.** The original wording and its reasoning
     * are kept here because the half that mattered is still true:
     *
     *   "The absence is the design, not an oversight: prices change by adding
     *    a version. Asserted so that adding `update`/`destroy` to the
     *    apiResource later is a deliberate act with a failing test attached."
     *
     * It was a deliberate act, and this is the failing test it was attached
     * to. What changed is only *which* absence is being defended. `PATCH` now
     * exists and edits a card's name, description and status — labels on a
     * pricing document. It still cannot reach a price: `UpdateRateCardRequest`
     * offers no such field and `PricedRate` throws on update, which the
     * immutability case below still proves.
     *
     * `DELETE` is unchanged and stays 405. A rate card that priced an invoice
     * is evidence; `status: archived` is how one is taken out of the way, and
     * that is what makes removing the route affordable rather than awkward.
     *
     * 405, not 404: the URI exists for GET, so the router reports that the
     * *method* is not allowed.
     */
    $this->actingAs($finance, 'sanctum')
        ->deleteJson("/api/v1/rate-cards/{$card->id}")
        ->assertStatus(405);

    expect($card->fresh()->name)->toBe('Standard');
});

/**
 * Editing a rate card — **its label, never its prices.**
 *
 * The owner asked to be able to edit rate cards, and the honest answer split in
 * two: a version cannot be edited (that is the module's central rule and what
 * makes an issued invoice reproducible), but a card's *name*, *description* and
 * *status* are not prices and had no edit path at all. A typo in a card name
 * was permanent, and `archived` sat in the enum with nothing able to set it.
 *
 * These cases pin the line between the two halves.
 */
it('renames a rate card without touching its prices', function () {
    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    $before = $card->versions()->first()->rates()->get()
        ->map(fn ($rate) => $rate->vehicle_category.':'.$rate->base_fare_minor->getMinorAmount()->toInt())
        ->sort()->values()->all();

    $this->actingAs($finance, 'sanctum')
        ->patchJson("/api/v1/rate-cards/{$card->getKey()}", [
            'name' => 'Renamed tariff',
            'description' => 'Now says what it is.',
        ])
        ->assertOk()
        ->assertJsonPath('data.name', 'Renamed tariff')
        ->assertJsonPath('data.description', 'Now says what it is.');

    $after = $card->fresh()->versions()->first()->rates()->get()
        ->map(fn ($rate) => $rate->vehicle_category.':'.$rate->base_fare_minor->getMinorAmount()->toInt())
        ->sort()->values()->all();

    // The whole point of allowing this edit at all: the money is untouched, so
    // every invoice already priced by this version stays reproducible.
    expect($after)->toBe($before);
});

it('leaves a field alone when the patch omits it', function () {
    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard();
    $originalName = $card->name;

    $this->actingAs($finance, 'sanctum')
        ->patchJson("/api/v1/rate-cards/{$card->getKey()}", ['status' => 'archived'])
        ->assertOk()
        ->assertJsonPath('data.status', 'archived');

    // A PATCH that nulls the fields it did not mention is the classic way to
    // lose a description nobody meant to delete.
    expect($card->fresh()->name)->toBe($originalName);
});

it('cannot promote a card or reprice it through the edit endpoint', function () {
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    // A second, non-default card — the fixture's own is already the default,
    // which would make an is_default assertion vacuous.
    $created = $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/rate-cards', rateCardPayload(['name' => 'Secondary', 'is_default' => false]))
        ->assertStatus(201);

    $id = $created->json('data.id');

    // Neither key has a rule, so neither is in `validated()`. `is_default` has
    // its own endpoint because promotion must demote the incumbent in one
    // transaction, and a second way in is the one that forgets to.
    $this->actingAs($finance, 'sanctum')
        ->patchJson("/api/v1/rate-cards/{$id}", [
            'name' => 'Still fine',
            'is_default' => true,
            'version' => ['rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 1]]],
        ])
        ->assertOk()
        ->assertJsonPath('data.name', 'Still fine')
        ->assertJsonPath('data.is_default', false);

    // One version still, priced as it was — nothing in that payload reached it.
    expect(RateCard::query()->findOrFail($id)->versions()->count())->toBe(1);
});

it('refuses an edit from a role that may not set prices', function () {
    ['dispatcher' => $dispatcher, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson("/api/v1/rate-cards/{$card->getKey()}", ['name' => 'Nope'])
        ->assertForbidden();
});
