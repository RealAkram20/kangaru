<?php

use App\Support\Money\Shillings;
use Illuminate\Support\Carbon;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Pricing\RateCardResolver;
use Modules\Billing\Pricing\TripPricingEngine;
use Modules\Billing\Pricing\WaitingTimeCalculator;
use Modules\Billing\Services\RateCardService;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * The arithmetic, asserted in shillings.
 *
 * These call the pricing engine directly rather than going through the API:
 * the question here is what a trip costs, and a total that is wrong by one
 * shilling is exactly as wrong whether or not it survived an HTTP round
 * trip. InvoiceGenerationTest covers the endpoint.
 *
 * Every expected figure below is arithmetic a person can check by hand
 * against the fixture's round-number rate card — 5,000 base, 500/km,
 * 200/waiting minute, 10 free minutes, 10,000 minimum.
 */
function priceOf(Trip $trip, RateCardVersion $version): array
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

it('charges base fare plus distance for a straightforward trip', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard();

    // 15,000 -> 15,042 on the odometer is 42 km.
    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    $result = priceOf($trip, $version);

    // 5,000 base + (500 x 42) distance = 26,000.
    expect($result['lines'][InvoiceLineType::BASE_FARE->value])->toBe(5_000);
    expect($result['lines'][InvoiceLineType::DISTANCE->value])->toBe(21_000);
    expect($result['total'])->toBe(26_000);

    // No waiting happened, so no waiting line is invented to say so.
    expect($result['lines'])->not->toHaveKey(InvoiceLineType::WAITING->value);
});

it('bills waiting time from the trip_events timeline, less the free allowance', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard();

    // One 15-minute pause. The rate card includes 10 minutes free, so 5
    // minutes are billable at 200 each.
    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        waitingPeriodSeconds: [15 * 60],
    );

    expect(app(WaitingTimeCalculator::class)->minutesFor($trip))->toBe(15);

    $result = priceOf($trip, $version);

    expect($result['lines'][InvoiceLineType::WAITING->value])->toBe(1_000);
    expect($result['total'])->toBe(27_000);
});

it('sums waiting seconds across pauses before truncating to minutes', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard(
            version: ['free_waiting_minutes' => 0],
        );

    // Two 90-second pauses. Truncating each pause on its own would give
    // 1 + 1 = 2 minutes and under-bill the client; the true total is 180
    // seconds, which is 3 minutes. This is the assertion that pins the
    // "sum seconds, truncate once" rule in WaitingTimeCalculator.
    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        waitingPeriodSeconds: [90, 90],
    );

    expect(app(WaitingTimeCalculator::class)->secondsFor($trip))->toBe(180);
    expect(app(WaitingTimeCalculator::class)->minutesFor($trip))->toBe(3);

    expect(priceOf($trip, $version)['lines'][InvoiceLineType::WAITING->value])->toBe(600);
});

it('lifts a small charge to the rate card minimum with a visible adjustment line', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard();

    // 1 km: 5,000 + 500 = 5,500, under the 10,000 minimum.
    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_001);

    $result = priceOf($trip, $version);

    // The adjustment is a line, not a silently rewritten total: the
    // arithmetic on the issued invoice has to add up.
    expect($result['lines'][InvoiceLineType::MINIMUM_CHARGE_ADJUSTMENT->value])->toBe(4_500);
    expect($result['total'])->toBe(10_000);
});

it('caps a large charge at the rate card maximum with a negative adjustment line', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard(
            rate: ['maximum_charge_minor' => 20_000],
        );

    // 42 km prices at 26,000, above the 20,000 cap.
    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    $result = priceOf($trip, $version);

    expect($result['lines'][InvoiceLineType::MAXIMUM_CHARGE_ADJUSTMENT->value])->toBe(-6_000);
    expect($result['total'])->toBe(20_000);
});

it('applies the night multiplier only to trips that started inside the night window', function () {
    // 20:00 UTC is 23:00 in Africa/Kampala — inside a 22:00-06:00 window
    // that wraps midnight. Testing in UTC alone would put this at 20:00 and
    // miss the window entirely, which is the bug the timezone conversion
    // in TripPricingEngine::multiplierFor() exists to prevent.
    $this->travelTo(Carbon::parse('2026-07-15 20:00:00', 'UTC'));

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'version' => $version] = BillingFixtures::tenantWithRateCard(
            version: [
                'night_starts_at' => '22:00',
                'night_ends_at' => '06:00',
                'night_multiplier_bp' => 12_500,
            ],
        );

    $night = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);
    $result = priceOf($night, $version);

    // 5,000 x 1.25 = 6,250 and 21,000 x 1.25 = 26,250.
    expect($result['lines'][InvoiceLineType::BASE_FARE->value])->toBe(6_250);
    expect($result['lines'][InvoiceLineType::DISTANCE->value])->toBe(26_250);
    expect($result['total'])->toBe(32_500);

    // 09:00 UTC is 12:00 in Kampala — the same rate card, a daytime trip,
    // and no surcharge.
    $this->travelTo(Carbon::parse('2026-07-16 09:00:00', 'UTC'));

    $vehicleTwo = Vehicle::factory()->forTenant($tenant)->create(['category' => 'sedan']);
    $day = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicleTwo, $driver, 15_000, 15_042);

    expect(priceOf($day, $version)['total'])->toBe(26_000);
});

it('rounds a fractional amount by the rule the rate card version states', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    // 333/km x 42 km = 13,986, then x 1.15 = 16,083.9 — the only figure in
    // this suite that does not land on a whole shilling, and therefore the
    // only one where the rounding rule is observable.
    $rates = [[
        'vehicle_category' => 'sedan',
        'base_fare_minor' => 5_000,
        'per_km_minor' => 333,
        'per_waiting_minute_minor' => 0,
        'minimum_charge_minor' => 0,
    ]];

    $nightWindow = [
        'effective_from' => '2020-01-01',
        'night_starts_at' => '00:00',
        'night_ends_at' => '23:59',
        'night_multiplier_bp' => 11_500,
        'rates' => $rates,
    ];

    $service = app(RateCardService::class);

    $halfUpCard = $service->create([
        'name' => 'Half up', 'version' => ['rounding_mode' => 'half_up', ...$nightWindow],
    ], $finance);

    $downCard = $service->create([
        'name' => 'Down', 'version' => ['rounding_mode' => 'down', ...$nightWindow],
    ], $finance);

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    $halfUp = priceOf($trip, $halfUpCard->versions()->with('rates')->first());
    $down = priceOf($trip, $downCard->versions()->with('rates')->first());

    // 5,000 x 1.15 = 5,750 exactly under either rule.
    expect($halfUp['lines'][InvoiceLineType::BASE_FARE->value])->toBe(5_750);
    expect($down['lines'][InvoiceLineType::BASE_FARE->value])->toBe(5_750);

    // 16,083.9 rounds up under half-up and down under down. One shilling
    // apart, which is the whole point of storing the rule per rate card
    // and copying it onto every line.
    expect($halfUp['lines'][InvoiceLineType::DISTANCE->value])->toBe(16_084);
    expect($down['lines'][InvoiceLineType::DISTANCE->value])->toBe(16_083);
});

it('refuses to price a vehicle category the rate card version does not cover', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'driver' => $driver,
        'version' => $version] = BillingFixtures::tenantWithRateCard();

    // The fixture's version prices `sedan` and nothing else.
    $bus = Vehicle::factory()->forTenant($tenant)->create(['category' => 'bus']);
    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $bus, $driver);

    // Not "charge zero", not "fall back to another category" — a refusal.
    // AGENTS.md forbids hardcoded prices, so there is no default to reach
    // for, and billing a bus at nothing would be a silent revenue loss.
    expect(fn () => app(TripPricingEngine::class)->price($trip, $version))
        ->toThrow(RateCardNotConfiguredException::class);
});

it('resolves the version that was in force on the trip date, not the newest one', function () {
    $this->travelTo(Carbon::parse('2026-03-10 09:00:00', 'UTC'));

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver, 'card' => $card, 'finance' => $finance] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    // A price rise dated after the trip took place.
    app(RateCardService::class)->addVersion($card, [
        'effective_from' => '2026-06-01',
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 50_000,
            'per_km_minor' => 5_000,
            'minimum_charge_minor' => 0,
        ]],
    ], $finance);

    $resolved = app(RateCardResolver::class)->resolveFor($trip);

    // Version 1, because that is what was in force in March. This is the
    // property that lets a client re-check an old invoice a year later and
    // get the same number.
    expect($resolved->version)->toBe(1);
    expect(priceOf($trip, $resolved)['total'])->toBe(26_000);
});
