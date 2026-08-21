<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Billing\Enums\RateCardStatus;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Models\VehicleCategory;
use Tests\Support\BillingFixtures;

/**
 * ADR-0050 §5 — the half of the owner's ask that reads "synced to the rate
 * cards", and the honest meaning it has.
 *
 * A rate card version is immutable, so **nothing can add a price to a tariff
 * that already exists**. Creating a category therefore cannot make it
 * priceable anywhere; the only truthful thing the platform can do is say
 * which cards do not price it, and let Finance write a new version.
 *
 * The two directions of the sync, and what breaks if either is wrong:
 *
 * 1. **Category to tariff** — the list says which cards are missing it. If
 *    this is silently empty, the screen claims a category is priced
 *    everywhere and a dispatcher gets `RATE_CARD_NOT_CONFIGURED` at the
 *    moment a client is standing there.
 * 2. **Tariff to category** — a rate card version can price a category the
 *    office added this morning, without a deploy. This is the direction that
 *    was actually broken: the validator read a PHP constant.
 */
// `categoryAdmin()` and `categoryReader()` are declared in
// VehicleCategoryTest.php. Pest's test-file functions are global, so
// re-declaring one here is a fatal error rather than a shadow — the same
// trap `fleetAdmin()` in Feature/Fleet/AvailabilityTest.php already sets.

/* --------------------------------------------------------- direction 1 --- */

it('names the rate cards that do not price a category', function () {
    // One card, pricing sedans only.
    BillingFixtures::tenantWithRateCard(['vehicle_category' => 'sedan']);

    $response = $this->actingAs(categoryAdmin())
        ->getJson('/api/v1/vehicle-categories')
        ->assertOk();

    $rows = collect($response->json('data'))->keyBy('key');

    // Priced: nothing is missing it.
    expect($rows['sedan']['unpriced_rate_cards'])->toBe([]);

    // Not priced: the card is named, so the warning can say which one
    // rather than that something somewhere is unpriced.
    expect($rows['bus']['unpriced_rate_cards'])->toHaveCount(1);
    expect($rows['bus']['unpriced_rate_cards'][0]['name'])->toBe('Standard');
    expect($rows['bus']['rate_cards_total'])->toBe(1);
});

it('reports a brand-new category as priced by nothing at all', function () {
    BillingFixtures::tenantWithRateCard(['vehicle_category' => 'sedan']);

    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'quad_bike', 'name' => 'Quad bike'])
        ->assertStatus(201);

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    // The case the whole warning exists for. A category with no row in any
    // version has no entry in the priced map at all, so this is the
    // fallback path — and getting it wrong would report the *new* category
    // as the one that is fully priced.
    expect($rows['quad_bike']['unpriced_rate_cards'])->toHaveCount(1);
});

it('says a category is unpriced when only an older version priced it', function () {
    ['card' => $card, 'finance' => $finance] = BillingFixtures::tenantWithRateCard(
        ['vehicle_category' => 'sedan']
    );

    // A second version that drops sedan and prices vans instead. The card
    // is not "still pricing sedans" — the next trip on it will not price a
    // sedan at all, which is exactly what the screen has to say.
    $this->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->id}/versions", [
            'effective_from' => '2026-01-01',
            'rates' => [['vehicle_category' => 'van', 'base_fare_minor' => 9_000, 'per_km_minor' => 700]],
        ])
        ->assertStatus(201);

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    expect($rows['van']['unpriced_rate_cards'])->toBe([]);
    expect($rows['sedan']['unpriced_rate_cards'])->toHaveCount(1);
});

it('ignores archived rate cards, which price nothing new', function () {
    ['card' => $card] = BillingFixtures::tenantWithRateCard(['vehicle_category' => 'sedan']);
    $card->update(['status' => RateCardStatus::ARCHIVED]);

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    // No active card at all, so the honest figure is zero rather than a
    // warning naming a card nobody can bill against.
    expect($rows['bus']['rate_cards_total'])->toBe(0);
    expect($rows['bus']['unpriced_rate_cards'])->toBe([]);
});

it('counts the live fleet on each category, excluding deleted vehicles', function () {
    Vehicle::factory()->count(2)->create(['category' => 'suv']);
    Vehicle::factory()->create(['category' => 'suv'])->delete();

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    // Two, not three: the office is being told how much of the *running*
    // fleet a retirement would affect.
    expect($rows['suv']['vehicles_count'])->toBe(2);
    expect($rows['bus']['vehicles_count'])->toBe(0);
});

it('omits the computed fields on a single-category response rather than sending zeroes', function () {
    $body = $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'quad_bike', 'name' => 'Quad bike'])
        ->assertStatus(201)
        ->json('data');

    // `unpriced_rate_cards: []` on a create would read as "priced on every
    // tariff", which is the opposite of the truth for a category that has
    // existed for one millisecond.
    expect($body)->not->toHaveKey('unpriced_rate_cards');
    expect($body)->not->toHaveKey('rate_cards_total');
});

/* --------------------------------------------------------- direction 2 --- */

it('prices a category the office added this morning, with no deploy', function () {
    ['card' => $card, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $this->actingAs(categoryAdmin())
        ->postJson('/api/v1/vehicle-categories', ['key' => 'quad_bike', 'name' => 'Quad bike'])
        ->assertStatus(201);

    // The direction that was genuinely broken: this validated against
    // `Vehicle::CATEGORIES`, so a category added through the console could
    // never be priced until somebody shipped a build.
    $this->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->id}/versions", [
            'effective_from' => '2026-02-01',
            'rates' => [['vehicle_category' => 'quad_bike', 'base_fare_minor' => 4_000, 'per_km_minor' => 400]],
        ])
        ->assertStatus(201);

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    expect($rows['quad_bike']['unpriced_rate_cards'])->toBe([]);
});

it('refuses to price a retired category on a new version', function () {
    ['card' => $card, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    VehicleCategory::query()->where('key', 'bus')->update(['active' => false]);

    $this->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->id}/versions", [
            'effective_from' => '2026-02-01',
            'rates' => [['vehicle_category' => 'bus', 'base_fare_minor' => 4_000]],
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('rates.0.vehicle_category');

    expect($card->fresh()->versions()->count())->toBe(1);
});

it('leaves a version that already prices a retired category exactly as it was', function () {
    ['card' => $card] = BillingFixtures::tenantWithRateCard(['vehicle_category' => 'sedan']);

    VehicleCategory::query()->where('key', 'sedan')->update(['active' => false]);

    // Retiring changes no price and voids no record (ADR-0050 §3). The
    // version still prices sedans and every invoice it raised still
    // reproduces.
    $version = $card->versions()->with('rates')->first();

    expect($version->rates)->toHaveCount(1);
    expect($version->rates->first()->vehicle_category)->toBe('sedan');
    expect($version->rateFor('sedan'))->not->toBeNull();
});

/* --------------------------------------------------------- scoping ------- */

it('answers a platform actor with every tariff on the platform, not an empty list', function () {
    // The ADR-0006 trap, in the form it takes here. `RateCard`,
    // `RateCardVersion` and `RateCardRate` are all tenant-scoped — the last
    // through `PricedRate`, so grepping it for `BelongsToTenant` finds
    // nothing — and `TenantScope` fails closed for platform staff, who bind
    // no tenant. A plain query would answer **zero cards to the roles that
    // own pricing**, and this screen would then warn that every category is
    // unpriced on a platform that is billing correctly.
    BillingFixtures::tenantWithRateCard(['vehicle_category' => 'sedan']);
    BillingFixtures::tenantWithRateCard(['vehicle_category' => 'van']);

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    // Two cards seen, not zero and not one.
    expect($rows['sedan']['rate_cards_total'])->toBe(2);

    // Each priced on exactly the one card that prices it — which is the
    // assertion that fails if `forActor()` is dropped from the *rates*
    // query alone, because then every category looks unpriced everywhere.
    expect($rows['sedan']['unpriced_rate_cards'])->toHaveCount(1);
    expect($rows['van']['unpriced_rate_cards'])->toHaveCount(1);
    expect($rows['bus']['unpriced_rate_cards'])->toHaveCount(2);
});

/**
 * The corporate client's read, and the line it must not cross (ADR-0051 §3).
 *
 * The two corporate roles hold `$clientReads` — companies, zones, routes —
 * and none of the fleet, so this endpoint answered them 403 and their
 * booking form would have rendered an empty select. Opening it was necessary
 * and it is exactly the kind of policy widening that leaks something.
 *
 * What it must expose is the **vocabulary**: "Sedan, SUV, Van". What it must
 * not is the **roster** — `docs/security-gate.md` F2 keeps the fleet register
 * from clients, and how many vans Shanitah owns is that register in
 * aggregate. So the two tests below are one decision and are written
 * together on purpose.
 */
it('lets a corporate client read the category names, so their booking form can offer them', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    $clientAdmin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $this->actingAs($clientAdmin, 'sanctum')
        ->getJson('/api/v1/vehicle-categories')
        ->assertOk()
        ->assertJsonCount(9, 'data')
        ->assertJsonPath('data.3.name', 'SUV');
});

it('never tells a corporate client how many vehicles the fleet has', function () {
    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();
    Vehicle::factory()->count(4)->create(['category' => 'van']);

    $clientAdmin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $rows = collect(
        $this->actingAs($clientAdmin, 'sanctum')->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    // Absent, not zero. A zero would be a *false* claim about the fleet
    // rather than a withheld one, and this endpoint's whole payload is read
    // by a bank's transport officer.
    expect($rows['van'])->not->toHaveKey('vehicles_count');

    // The pricing figures stay — they are already `forActor()`-scoped, so a
    // client reads their own tariffs and no other client's.
    expect($rows['van'])->toHaveKey('unpriced_rate_cards');
});

it('still gives the fleet counts to somebody who may read the fleet', function () {
    Vehicle::factory()->count(4)->create(['category' => 'van']);

    $rows = collect(
        $this->actingAs(categoryAdmin())->getJson('/api/v1/vehicle-categories')->json('data')
    )->keyBy('key');

    // The other half of the same guard: withholding it from everybody would
    // pass the test above and quietly remove the figure the fleet screen is
    // built around.
    expect($rows['van']['vehicles_count'])->toBe(4);
});
