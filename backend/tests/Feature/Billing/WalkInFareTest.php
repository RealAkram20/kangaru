<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * The walk-in tariff (ADR-0026).
 *
 * The whole point is that a hailing ride is charged per kilometre at a rate
 * that depends on the vehicle — and that the rate lives on a rate card the
 * *platform* owns, because a walk-in has no client whose prices could apply.
 */
function publicTariff(array $rates = ['sedan' => [2_000, 1_500]]): RateCard
{
    // Delegated to `BillingFixtures` because Dispatch needs the same card:
    // Billing asks what a walk-in ride costs, and the driver's offer payload
    // asks what a driver is shown before accepting one. Two copies would
    // drift. Kept as a local name because every `it()` below reads better
    // saying `publicTariff()` than the class path.
    return BillingFixtures::publicTariff($rates);
}

function completedWalkInTrip(string $category = 'sedan', string $distanceKm = '10.00'): Trip
{
    return Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => $category]))
        ->forDriver(Driver::factory()->create())
        ->create([
            'status' => TripStatus::TRIP_COMPLETED,
            'distance_km' => $distanceKm,
            'started_at' => now()->subHour(),
            'completed_at' => now(),
        ]);
}

it('charges the base fare plus the distance, at the rate for that vehicle', function () {
    publicTariff();

    // 2,000 base + 10 km x 1,500 = 17,000 shillings.
    $trip = app(WalkInFareService::class)->settle(completedWalkInTrip());

    expect($trip->fare_minor)->toBe(17_000);
    expect($trip->fare_currency)->toBe('UGX');
});

it('charges a different vehicle at its own rate', function () {
    // The requirement in one test: the rate depends on what turned up.
    publicTariff(['sedan' => [2_000, 1_500], 'boda' => [1_000, 700]]);

    $sedan = app(WalkInFareService::class)->settle(completedWalkInTrip('sedan'));
    $boda = app(WalkInFareService::class)->settle(completedWalkInTrip('boda'));

    expect($sedan->fare_minor)->toBe(17_000);
    expect($boda->fare_minor)->toBe(8_000);
});

it('records what priced the fare, so it can be re-derived', function () {
    $card = publicTariff();

    $trip = app(WalkInFareService::class)->settle(completedWalkInTrip());

    // A total with no version behind it is a number nobody can defend when
    // somebody disputes it. Versions are frozen once used, so this is what
    // makes the amount reproducible years later.
    // Read past the tenant scope, like everything else about the platform
    // tariff: `$card->versions()` is scoped and returns nothing here.
    $version = RateCardVersion::allTenants()->where('rate_card_id', $card->id)->first();

    expect($trip->fare_rate_card_version_id)->toBe($version->id);
    expect($trip->fare_computed_at)->not->toBeNull();
});

it('never re-prices a ride that has already been settled', function () {
    publicTariff();
    $service = app(WalkInFareService::class);

    $trip = $service->settle(completedWalkInTrip());
    $original = $trip->fare_minor;

    // The tariff moves. A finished journey must not silently re-quote
    // against today's prices — the passenger has already paid.
    RateCardRate::query()->update(['per_km_minor' => 99_000]);

    expect($service->settle($trip->fresh())->fare_minor)->toBe($original);
});

it('refuses to price a walk-in from a client\'s rate card', function () {
    // No public tariff — but a client has one, marked default, and its
    // prices are negotiated. Falling back to it would bill a stranger at a
    // bank's rate, in whichever direction that happened to be wrong.
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    // Through the shared fixture, which goes through `RateCardService` —
    // hand-writing a version misses columns the service fills and produces
    // a history no service could have made (see `RateCardFactory`).
    BillingFixtures::tenantWithRateCard();

    app(TenantContext::class)->set(null);

    expect(fn () => app(WalkInFareService::class)->settle(completedWalkInTrip()))
        ->toThrow(RateCardNotConfiguredException::class);
});

it('completes the trip even when nobody has priced that vehicle', function () {
    // Only sedans are priced; a boda finishes a ride.
    publicTariff(['sedan' => [2_000, 1_500]]);

    $trip = completedWalkInTrip('boda');

    // The listener swallows, and this is the assertion behind that choice:
    // throwing would roll back the completion, so a driver could not close a
    // job because an operator had not priced their category — and the
    // odometer reading, which is the evidence this platform is built on,
    // would be lost with it.
    expect($trip->fresh()->status)->toBe(TripStatus::TRIP_COMPLETED);

    // Unpriced and visibly so. A null is a question somebody can answer
    // later; a zero would look like a free ride and be found by
    // reconciliation weeks afterwards.
    expect($trip->fresh()->fare_minor)->toBeNull();
});

it('estimates a ride before anybody drives it', function () {
    publicTariff();

    // Kampala centre to roughly 1.1 km north.
    $quote = app(WalkInFareService::class)->quote('sedan', 0.3476, 32.5825, 0.3576, 32.5825);

    expect($quote)->not->toBeNull();
    expect($quote->distanceKm)->toBeGreaterThan(1.0);
    expect($quote->distanceKm)->toBeLessThan(1.2);
    // 2,000 base + ~1.11 km x 1,500.
    expect($quote->totalMinor)->toBeGreaterThan(3_000);
    expect($quote->toArray()['is_estimate'])->toBeTrue();
});

it('shows no estimate rather than a wrong one when a point is missing', function () {
    publicTariff();

    // A drop-off typed by hand has no coordinates until something geocodes
    // it. Null is a screen with no figure on it; a zero would read as a free
    // ride.
    expect(app(WalkInFareService::class)->quote('sedan', 0.3476, 32.5825, null, null))->toBeNull();
});

it('leaves a corporate trip to the invoice, not the fare column', function () {
    publicTariff();

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan']))
        ->forDriver(Driver::factory()->create())
        ->create(['status' => TripStatus::TRIP_COMPLETED, 'distance_km' => '10.00']);

    app(TenantContext::class)->set(null);

    // Two numbers for one journey is the dispute this platform exists to
    // avoid. A client's trip is priced by `InvoiceService`, on a document
    // number series, when Finance issues one.
    expect($trip->fresh()->fare_minor)->toBeNull();
});

it('prices a walk-in ride the moment the driver completes it', function () {
    publicTariff();

    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan']))
        ->forDriver($driver)
        ->create([
            'status' => TripStatus::TRIP_STARTED,
            'odometer_start' => 1_000,
            'started_at' => now()->subHour(),
        ]);

    // Through the endpoint, not the service: the passenger is at the kerb
    // waiting to be told what to pay, so the fare has to exist by the time
    // the driver's app gets its response — not whenever a worker next runs.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value,
            'odometer_end' => 1_010,
        ])
        ->assertOk();

    expect($trip->fresh()->fare_minor)->toBe(17_000);
});
