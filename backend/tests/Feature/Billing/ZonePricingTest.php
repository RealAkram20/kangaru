<?php

use App\Enums\UserRole;
use App\Exceptions\FinancialRecordImmutableException;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Money\Shillings;
use Database\Factories\ZoneFactory;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Pricing\RateCardResolver;
use Modules\Billing\Pricing\TripPricingEngine;
use Modules\Billing\Services\RateCardService;
use Modules\Bookings\Models\Booking;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Models\Zone;
use Modules\Trips\Models\Trip;
use Tests\Support\BillingFixtures;

/**
 * Zone pricing — the billing half of ADR-0021.
 *
 * The engine's job here is small and exact: resolve the pickup to a zone,
 * and let that zone choose which rate row supplies the unit amounts.
 * Everything downstream — rounding, night multipliers, minimum and maximum
 * adjustments — is already covered by TripPricingTest and must keep working
 * unchanged, which is why this file asserts totals rather than re-testing
 * the arithmetic those cover.
 *
 * Every figure below is checkable by hand against two rate rows:
 *
 *   default zone-less rate   5,000 base · 500/km · 200/waiting min · 10,000 min
 *   Central Kampala zone     8,000 base · 700/km · 300/waiting min · 12,000 min
 *
 * so a 42 km trip is 26,000 outside the zone and 37,400 inside it.
 */

/** Inside ZoneFactory's default Central Kampala box (0.28–0.39 N, 32.53–32.64 E). */
const ZONE_PRICING_PICKUP_INSIDE = ['lat' => 0.3476, 'lng' => 32.5825];

/** Entebbe: real, served, and outside that box. */
const ZONE_PRICING_PICKUP_OUTSIDE = ['lat' => 0.0510, 'lng' => 32.4460];

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function zonePricingRate(Zone $zone, array $overrides = []): array
{
    return [
        'zone_id' => $zone->id,
        'base_fare_minor' => 8_000,
        'per_km_minor' => 700,
        'per_waiting_minute_minor' => 300,
        'minimum_charge_minor' => 12_000,
        'maximum_charge_minor' => null,
        ...$overrides,
    ];
}

function zonePricingBooking(Tenant $tenant, ?array $at): Booking
{
    return Booking::factory()->forTenant($tenant)->create([
        'origin_latitude' => $at['lat'] ?? null,
        'origin_longitude' => $at['lng'] ?? null,
    ]);
}

/**
 * Posts a rate card whose only zone rate names `$zoneId`, and asserts it is
 * refused on the field a finance officer can see and correct.
 *
 * Each caller is its own test rather than a loop, so that mutating one
 * filter out of `StoreRateCardVersionRequest::priceableZones()` names which
 * rule stopped holding instead of failing an unlabelled iteration.
 */
function zonePricingRefusal(int $zoneId): void
{
    ['finance' => $finance] = BillingFixtures::tenantWithRateCard();

    test()->actingAs($finance)->postJson('/api/v1/rate-cards', [
        'name' => "Card for zone {$zoneId}",
        'version' => [
            'effective_from' => '2026-01-01',
            'rates' => [[
                'vehicle_category' => 'sedan',
                'base_fare_minor' => 5_000,
                'zone_rates' => [['zone_id' => $zoneId, 'base_fare_minor' => 9_000]],
            ]],
        ],
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['version.rates.0.zone_rates.0.zone_id']);
}

/**
 * Prices through RateCardResolver rather than a hand-held version, so the
 * eager loading billing actually runs with is the thing under test.
 *
 * @return array{total: int, lines: array<string, array{amount: int, zone: string|null, zone_id: int|null, description: string}>}
 */
function zonePricingOf(Trip $trip): array
{
    $price = app(TripPricingEngine::class)->price($trip, app(RateCardResolver::class)->resolveFor($trip));

    return [
        'total' => Shillings::toMinor($price->total()),
        'lines' => collect($price->lines)->mapWithKeys(fn ($line) => [
            $line->type->value => [
                'amount' => Shillings::toMinor($line->amount),
                'zone' => $line->zone,
                'zone_id' => $line->zoneId,
                'description' => $line->description,
            ],
        ])->all(),
    ];
}

it('prices a trip at the zone rate when the pickup falls inside a priced zone', function () {
    $zone = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($zone)]],
        );

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_INSIDE),
    );

    $result = zonePricingOf($trip);

    // 8,000 base + (700 x 42) = 37,400, not the 26,000 the default rate
    // would have charged. The whole feature in one number.
    expect($result['lines'][InvoiceLineType::BASE_FARE->value]['amount'])->toBe(8_000);
    expect($result['lines'][InvoiceLineType::DISTANCE->value]['amount'])->toBe(29_400);
    expect($result['total'])->toBe(37_400);

    // Every line records which zone priced it — including the id, because a
    // zone can be renamed and the name alone could not identify the rate row
    // that produced the amount.
    foreach ($result['lines'] as $line) {
        expect($line['zone'])->toBe('Central Kampala');
        expect($line['zone_id'])->toBe($zone->id);
    }

    // And the document says so in words, because the client's question is
    // "why is this base fare 8,000 when my rate card says 5,000".
    expect($result['lines'][InvoiceLineType::BASE_FARE->value]['description'])
        ->toBe('Base fare (Central Kampala)');
    expect($result['lines'][InvoiceLineType::DISTANCE->value]['description'])
        ->toBe('Distance travelled (42.00 km, Central Kampala)');
});

it('falls back to the default rate when the pickup is outside every priced zone', function () {
    $zone = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($zone)]],
        );

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_OUTSIDE),
    );

    $result = zonePricingOf($trip);

    expect($result['total'])->toBe(26_000);

    // Null, not the name of the zone the pickup missed. The column means
    // "the zone whose rate priced this line", which is what lets every
    // invoice issued before zone pricing existed still read correctly.
    foreach ($result['lines'] as $line) {
        expect($line['zone'])->toBeNull();
        expect($line['zone_id'])->toBeNull();
    }

    // And the wording is byte-for-byte what it was before this feature.
    expect($result['lines'][InvoiceLineType::BASE_FARE->value]['description'])->toBe('Base fare');
});

it('prices a walk-in trip with no booking at the default rate rather than refusing', function () {
    $zone = Zone::factory()->create();

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($zone)]],
        );

    // ADR-0012's walk-in path raises a trip at the desk with no booking, so
    // there are no pickup coordinates to resolve. Refusing to bill it would
    // make drawing a zone a breaking change for the counter.
    $noBooking = BillingFixtures::completedTrip($tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042);

    expect(zonePricingOf($noBooking)['total'])->toBe(26_000);
});

it('prices a phone booking with no coordinates at the default rate', function () {
    $zone = Zone::factory()->create();

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($zone)]],
        );

    // A booking taken over the phone, and every booking made before ADR-0020
    // added the columns. Same answer, for the same reason.
    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, null),
    );

    expect(zonePricingOf($trip)['total'])->toBe(26_000);
});

it('prices at the default rate inside a zone the rate card does not price', function () {
    // The zone exists, the pickup is in it, and this rate card says nothing
    // about it. A rate card must not stop being able to bill because
    // somebody in operations drew a boundary.
    Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_INSIDE),
    );

    $result = zonePricingOf($trip);

    expect($result['total'])->toBe(26_000);
    // The zone contributed nothing to the amount, so it is not recorded as
    // having priced the line.
    expect($result['lines'][InvoiceLineType::BASE_FARE->value]['zone'])->toBeNull();
});

it('lets the narrowest zone containing the pickup set the price', function () {
    $town = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard();

    // A client campus inside the town, priced lower — the contract discount
    // a corporate client negotiates for their own premises. Priority 10
    // beats the town's 50, and nobody had to say so.
    $campus = Zone::factory()->forClient($tenant->id)->create([
        'name' => 'Bank campus',
        'boundary' => ZoneFactory::box(0.3400, 32.5700, 0.3600, 32.5900),
    ]);

    $card = app(RateCardService::class)->create([
        'name' => 'Zoned',
        'is_default' => true,
        'version' => [
            'effective_from' => '2020-01-01',
            'free_waiting_minutes' => 10,
            'rates' => [[
                'vehicle_category' => 'sedan',
                'base_fare_minor' => 5_000,
                'per_km_minor' => 500,
                'minimum_charge_minor' => 0,
                'zone_rates' => [
                    zonePricingRate($town),
                    zonePricingRate($campus, ['base_fare_minor' => 2_000, 'per_km_minor' => 250]),
                ],
            ]],
        ],
    ], $finance);

    expect($card->is_default)->toBeTrue();

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_INSIDE),
    );

    $result = zonePricingOf($trip);

    // 2,000 + (250 x 42) = 12,500 — the campus rate, not the town's 37,400.
    expect($result['total'])->toBe(12_500);
    expect($result['lines'][InvoiceLineType::BASE_FARE->value]['zone'])->toBe('Bank campus');
});

it('never lets another client zone decide what this client is charged', function () {
    $town = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($town)]],
        );

    $other = Tenant::factory()->create();

    // Another client draws their campus over the same ground. A client zone
    // outranks a town (priority 10 beats 50), so if zone resolution were not
    // tenant-scoped this would win, carry no rate on *this* client's card,
    // and quietly drop the trip back to the default rate — a competitor's
    // map editor changing what a bank is billed.
    //
    // The assertion is therefore that the town rate still applies, not that
    // no zone applies. Asserting the default rate here would pass whether or
    // not the leak existed, which is exactly what an earlier draft of this
    // test did until the scoping was mutated out and it stayed green.
    Zone::factory()->forClient($other->id)->create([
        'name' => 'Rival campus',
        'boundary' => ZoneFactory::box(0.2800, 32.5300, 0.3900, 32.6400),
    ]);

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_INSIDE),
    );

    $result = zonePricingOf($trip);

    expect($result['total'])->toBe(37_400);
    expect($result['lines'][InvoiceLineType::BASE_FARE->value]['zone'])->toBe('Central Kampala');
});

it('charges waiting time and the minimum adjustment at the zone rate too', function () {
    $zone = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'vehicle' => $vehicle,
        'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($zone)]],
        );

    // 1 km and a 15-minute pause: 8,000 + 700 + (5 billable x 300) = 10,200,
    // under the zone's own 12,000 minimum.
    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_001,
        waitingPeriodSeconds: [15 * 60],
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_INSIDE),
    );

    $result = zonePricingOf($trip);

    // Waiting is priced by the zone even though it is never multiplied by
    // the night rate: a zone rate is a price, not a surcharge stacked on one.
    expect($result['lines'][InvoiceLineType::WAITING->value]['amount'])->toBe(1_500);
    expect($result['lines'][InvoiceLineType::WAITING->value]['zone'])->toBe('Central Kampala');

    // The minimum comes from the zone rate as well, and the adjustment line
    // carries the same zone as the lines it adjusts.
    expect($result['lines'][InvoiceLineType::MINIMUM_CHARGE_ADJUSTMENT->value]['amount'])->toBe(1_800);
    expect($result['lines'][InvoiceLineType::MINIMUM_CHARGE_ADJUSTMENT->value]['zone'])->toBe('Central Kampala');
    expect($result['total'])->toBe(12_000);
});

it('keeps an issued invoice reproducible after the zone is renamed and retired', function () {
    $zone = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant, 'finance' => $finance, 'dispatcher' => $dispatcher,
        'vehicle' => $vehicle, 'driver' => $driver] = BillingFixtures::tenantWithRateCard(
            rate: ['zone_rates' => [zonePricingRate($zone)]],
        );

    $trip = BillingFixtures::completedTrip(
        $tenant, $dispatcher, $vehicle, $driver, 15_000, 15_042,
        booking: zonePricingBooking($tenant, ZONE_PRICING_PICKUP_INSIDE),
    );

    $response = $this->actingAs($finance)
        ->withHeader('Idempotency-Key', 'zone-pricing-reproducibility')
        ->postJson("/api/v1/trips/{$trip->id}/invoice");

    $response->assertCreated();
    expect($response->json('data.total_minor'))->toBe(37_400);

    $lines = $response->json('data.lines');
    expect($lines)->toHaveCount(2);

    foreach ($lines as $line) {
        expect($line['inputs']['zone'])->toBe('Central Kampala');
        expect($line['inputs']['zone_id'])->toBe($zone->id);
    }

    // Operations renames the zone and then retires it. Both are ordinary
    // map edits; neither may move a shilling on a document already sent to
    // a client.
    $zone->update(['name' => 'Kampala Central Business District']);
    $zone->delete();

    $invoice = Invoice::query()
        ->where('uuid', $response->json('data.uuid'))
        ->firstOrFail()
        ->load('lines');

    foreach ($invoice->lines as $line) {
        // The stored name is the snapshot the document was issued with; the
        // id still points at the (soft-deleted) zone that priced it.
        expect($line->zone)->toBe('Central Kampala');
        expect($line->zone_id)->toBe($zone->id);
        expect(Shillings::toMinor($line->recompute()))->toBe(Shillings::toMinor($line->amount()));
    }

    expect(Shillings::toMinor($invoice->total_minor))->toBe(37_400);
});

it('refuses a zone rate naming another client zone', function () {
    // One message for this, for a depot boundary, for a switched-off zone
    // and for a zone that never existed. Distinguishing them would confirm
    // that another client's map has something on it — the same reasoning
    // that makes a cross-tenant read a 404 and never a 403 (AGENTS.md).
    $other = Tenant::factory()->create();

    zonePricingRefusal(Zone::factory()->forClient($other->id)->create(['name' => 'Rival campus'])->id);
});

it('refuses a zone rate attached to a boundary that prices nothing', function () {
    // ZoneResolver::pricingZoneAt() only ever returns pricing and client
    // zones, so a rate on a depot boundary would be stored, shown on the
    // card, and used by no invoice ever. The version it lands on is
    // immutable the moment it exists, so the door is the only place this is
    // still correctable.
    zonePricingRefusal(Zone::factory()->create(['name' => 'Nakawa depot', 'kind' => ZoneKind::DEPOT])->id);
});

it('refuses a zone rate on a zone that is switched off', function () {
    zonePricingRefusal(Zone::factory()->inactive()->create(['name' => 'Retired band'])->id);
});

it('refuses a zone rate naming a zone that does not exist', function () {
    zonePricingRefusal(999_999);
});

it('refuses the same zone priced twice for one vehicle category', function () {
    $zone = Zone::factory()->create();

    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    // The unique index would refuse this too, as a 500 from a duplicate key.
    // A 422 naming the second row is the difference between "the system
    // broke" and "you entered Central Kampala twice".
    $this->actingAs($finance)->postJson("/api/v1/rate-cards/{$card->id}/versions", [
        'effective_from' => '2026-01-01',
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 5_000,
            'zone_rates' => [
                ['zone_id' => $zone->id, 'base_fare_minor' => 9_000],
                ['zone_id' => $zone->id, 'base_fare_minor' => 11_000],
            ],
        ]],
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['rates.0.zone_rates.1.zone_id']);
});

it('refuses a zone rate whose maximum charge sits below its minimum', function () {
    $zone = Zone::factory()->create();

    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard();

    // The same rule the default rate has, applied to the zone rate by the
    // same function — a zone price is a complete price, so it is wrong in
    // the same ways.
    $this->actingAs($finance)->postJson("/api/v1/rate-cards/{$card->id}/versions", [
        'effective_from' => '2026-01-01',
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 5_000,
            'zone_rates' => [[
                'zone_id' => $zone->id,
                'minimum_charge_minor' => 20_000,
                'maximum_charge_minor' => 10_000,
            ]],
        ]],
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['rates.0.zone_rates.0.maximum_charge_minor']);
});

it('serves a version zone rates nested under the category they override', function () {
    $zone = Zone::factory()->create(['name' => 'Central Kampala']);

    ['finance' => $finance, 'card' => $card] = BillingFixtures::tenantWithRateCard(
        rate: ['zone_rates' => [zonePricingRate($zone)]],
    );

    $response = $this->actingAs($finance)->getJson("/api/v1/rate-cards/{$card->id}");

    $response->assertOk();

    $rate = $response->json('data.versions.0.rates.0');

    expect($rate['base_fare_minor'])->toBe(5_000);
    expect($rate['zone_rates'])->toHaveCount(1);
    expect($rate['zone_rates'][0])->toMatchArray([
        'zone_id' => $zone->id,
        'zone_name' => 'Central Kampala',
        'base_fare_minor' => 8_000,
        'per_km_minor' => 700,
        'per_waiting_minute_minor' => 300,
        'minimum_charge_minor' => 12_000,
        'maximum_charge_minor' => null,
    ]);
});

it('refuses to let anyone edit or delete a zone rate once it exists', function () {
    $zone = Zone::factory()->create();

    ['card' => $card] = BillingFixtures::tenantWithRateCard(
        rate: ['zone_rates' => [zonePricingRate($zone)]],
    );

    /** @var RateCardVersion $version */
    $version = $card->versions()->with('rates.zoneRates')->firstOrFail();
    $zoneRate = $version->rates->first()->zoneRates->first();

    // A zone price that could be edited would make its version immutable in
    // name only — the same rule its parent rate has, inherited from the
    // PricedRate base rather than written twice.
    expect(fn () => $zoneRate->update(['base_fare_minor' => 1]))
        ->toThrow(FinancialRecordImmutableException::class);

    expect(fn () => $zoneRate->delete())
        ->toThrow(FinancialRecordImmutableException::class);
});

it('records a zone rate in the audit log the way every other rate card change is', function () {
    $zone = Zone::factory()->create(['name' => 'Central Kampala']);

    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard(
        rate: ['zone_rates' => [zonePricingRate($zone)]],
    );

    // AGENTS.md: "Every mutation to rate cards ... is written to an
    // append-only audit_logs table". A zone rate decides what a client pays,
    // so it is a rate card change like any other.
    expect(AuditLog::query()
        ->where('tenant_id', $tenant->id)
        // The morph alias, not the FQCN: AppServiceProvider enforces the map
        // so that moving a class can never orphan its audit rows.
        ->where('auditable_type', 'rate_card_zone_rate')
        ->where('action', 'created')
        ->count())->toBe(1);
});

it('keeps zone rates out of the reach of a role that may not set prices', function () {
    $zone = Zone::factory()->create();

    ['tenant' => $tenant] = BillingFixtures::tenantWithRateCard();

    // Zone pricing added no endpoint of its own — it rides in on the rate
    // card routes, whose policy confines price-setting to Super Admin and
    // Finance. This asserts that inheritance rather than assuming it.
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher)->postJson('/api/v1/rate-cards', [
        'name' => 'Dispatcher card',
        'version' => [
            'effective_from' => '2026-01-01',
            'rates' => [[
                'vehicle_category' => 'sedan',
                'base_fare_minor' => 1,
                'zone_rates' => [['zone_id' => $zone->id, 'base_fare_minor' => 1]],
            ]],
        ],
    ])->assertForbidden();
});
