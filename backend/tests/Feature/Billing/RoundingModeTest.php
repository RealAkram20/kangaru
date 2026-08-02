<?php

use App\Support\Money\Shillings;
use Brick\Math\RoundingMode as BrickRoundingMode;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Enums\RoundingMode;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Pricing\TripPrice;
use Modules\Billing\Pricing\TripPricingEngine;
use Modules\Billing\Services\RateCardService;
use Modules\Trips\Models\Trip;
use Tests\Support\BillingFixtures;

/**
 * Every rounding rule a rate card may select, priced end to end.
 *
 * `TripPricingTest` proves the rule is honoured at all, using half-up and
 * down. That leaves **half-down and up never exercised** — two of the four
 * options a client's contract can actually be written on, and two arms of
 * `RoundingMode::toBrick()` that nothing would catch if they were mapped to
 * the wrong Brick constant.
 *
 * That is not a coverage number, it is a money bug waiting for the first
 * client whose rate card says "always round up". AGENTS.md puts the rule on
 * the invoice line precisely so a dispute can be settled by reading the
 * document; a rule that was never tested cannot settle anything.
 *
 * PROJECT.md names billing correctness as risk #2. This is the cheapest
 * part of it to hold down.
 */

/**
 * This file's own pricing helper.
 *
 * `TripPricingTest` declares a `priceOf()` at file scope, which exists only
 * while that file is the one running — borrowing it makes this suite pass
 * as part of a full run and fail when run alone, which is the worst of both.
 *
 * @return array{total: int, lines: array<string, int>, price: TripPrice}
 */
function roundedPrice(Trip $trip, RateCardVersion $version): array
{
    $price = app(TripPricingEngine::class)->price($trip, $version);

    return [
        'total' => Shillings::toMinor($price->total()),
        'lines' => collect($price->lines)->mapWithKeys(fn ($line) => [
            $line->type->value => Shillings::toMinor($line->amount),
        ])->all(),
        'price' => $price,
    ];
}

/**
 * A version whose only variable is the rounding rule, priced over a trip
 * that lands on a deliberate half-shilling.
 *
 * 333/km x 42 km = 13,986, then x 1.15 = **16,083.90**. The fractional part
 * is exactly what makes the four rules separable; every other figure in the
 * billing suite lands whole and hides them.
 */
function versionRounding(string $mode, $finance)
{
    return app(RateCardService::class)->create([
        'name' => 'Rate card rounding '.$mode,
        'version' => [
            'effective_from' => '2020-01-01',
            'rounding_mode' => $mode,
            'night_starts_at' => '00:00',
            'night_ends_at' => '23:59',
            'night_multiplier_bp' => 11_500,
            'rates' => [[
                'vehicle_category' => 'sedan',
                'base_fare_minor' => 5_000,
                'per_km_minor' => 333,
                'per_waiting_minute_minor' => 0,
                'minimum_charge_minor' => 0,
            ]],
        ],
    ], $finance)->versions()->with('rates')->first();
}

it('prices the same trip differently under each of the four rounding rules', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $versions = collect(RoundingMode::cases())
        ->mapWithKeys(fn (RoundingMode $mode) => [$mode->value => versionRounding($mode->value, $finance)]);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    $distance = $versions->map(
        fn ($version) => roundedPrice($trip, $version)['lines'][InvoiceLineType::DISTANCE->value],
    );

    // 16,083.90 — the .9 decides it.
    //
    //   half_up   → nearest, ties up      → 16,084
    //   half_down → nearest, ties down    → 16,084 (.9 is not a tie)
    //   up        → away from zero always → 16,084
    //   down      → toward zero always    → 16,083
    //
    // Three of four agreeing here is the point rather than a weakness: it
    // is what proves `down` is the odd one out for the right reason, and
    // the tie case below separates the two that agree by accident.
    expect($distance['half_up'])->toBe(16_084);
    expect($distance['half_down'])->toBe(16_084);
    expect($distance['up'])->toBe(16_084);
    expect($distance['down'])->toBe(16_083);
});

it('separates half-up from half-down on an exact tie', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    // 125/km x 42 km = 5,250, x 1.15 = 6,037.50 — a true half, which is the
    // only input on which half-up and half-down can be told apart at all.
    // Without this case the two modes are indistinguishable and one of them
    // could be mapped to the other's Brick constant unnoticed.
    $tieVersion = fn (string $mode) => app(RateCardService::class)->create([
        'name' => 'Tie '.$mode,
        'version' => [
            'effective_from' => '2020-01-01',
            'rounding_mode' => $mode,
            'night_starts_at' => '00:00',
            'night_ends_at' => '23:59',
            'night_multiplier_bp' => 11_500,
            'rates' => [[
                'vehicle_category' => 'sedan',
                'base_fare_minor' => 0,
                'per_km_minor' => 125,
                'per_waiting_minute_minor' => 0,
                'minimum_charge_minor' => 0,
            ]],
        ],
    ], $finance)->versions()->with('rates')->first();

    $halfUp = $tieVersion('half_up');
    $halfDown = $tieVersion('half_down');

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    expect(roundedPrice($trip, $halfUp)['lines'][InvoiceLineType::DISTANCE->value])->toBe(6_038);
    expect(roundedPrice($trip, $halfDown)['lines'][InvoiceLineType::DISTANCE->value])->toBe(6_037);
});

it('stores the rule it used on the line, so an invoice states its own arithmetic', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $version = versionRounding('up', $finance);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    $price = roundedPrice($trip, $version)['price'];

    // AGENTS.md: "The rounding rule used is stored on the invoice line."
    // A line that carried the wrong rule would reproduce to a different
    // number than the one billed, which is the dispute this exists to end.
    foreach ($price->lines as $line) {
        expect($line->rounding)->toBe(RoundingMode::UP);
    }
});

it('maps every rule to a distinct Brick constant', function () {
    // Two cases mapped to the same constant would be invisible through
    // pricing wherever their answers happen to agree — which, per the
    // first test here, is three quarters of the time.
    $mapped = collect(RoundingMode::cases())->map(fn (RoundingMode $m) => $m->toBrick());

    expect($mapped->unique()->count())->toBe(count(RoundingMode::cases()));

    expect(RoundingMode::HALF_UP->toBrick())->toBe(BrickRoundingMode::HalfUp);
    expect(RoundingMode::HALF_DOWN->toBrick())->toBe(BrickRoundingMode::HalfDown);
    expect(RoundingMode::UP->toBrick())->toBe(BrickRoundingMode::Up);
    expect(RoundingMode::DOWN->toBrick())->toBe(BrickRoundingMode::Down);
});

it('falls back to half-up when configuration names a rule that does not exist', function () {
    config(['money.default_rounding' => 'banker']);

    // The branch that exists so a typo in an env file cannot stop a trip
    // being priced. Throwing here would take billing down for every tenant
    // over a configuration value nobody looked at.
    expect(RoundingMode::default())->toBe(RoundingMode::HALF_UP);
});

it('honours a valid configured default', function () {
    config(['money.default_rounding' => 'down']);

    expect(RoundingMode::default())->toBe(RoundingMode::DOWN);
});

it('gives every rule a label the rate card screen can show', function () {
    // Served by RateCardVersionResource as `rounding_mode_label`. A missing
    // arm here is a 500 on the rate card page rather than a wrong number,
    // but it is still the finance screen that breaks.
    foreach (RoundingMode::cases() as $mode) {
        expect($mode->label())->toBeString()->not->toBeEmpty();
    }
});
