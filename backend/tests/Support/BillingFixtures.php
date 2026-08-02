<?php

namespace Tests\Support;

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Models\RateCardVersion;
use Modules\Billing\Services\RateCardService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * Fixtures for the Billing suite.
 *
 * Two rules shape everything here, and both come from bugs this project has
 * already been bitten by:
 *
 * 1. **Nothing is written straight to a table it should not be.** Priced
 *    rate card versions come from RateCardService; trips are walked through
 *    TripStateMachine transition by transition. A `Trip` row inserted at
 *    `trip_completed` carries odometer readings and timestamps no transition
 *    ever set, and — worse for this module — an empty `trip_events` timeline,
 *    which is where waiting-time billing comes from. It would test nothing.
 *
 * 2. **The tenant is bound by hand.** These run outside the HTTP stack, so
 *    IdentifyTenant never fires. TenantScope fails closed, so a forgotten
 *    binding does not error — it silently returns nothing, and the test
 *    passes vacuously.
 */
class BillingFixtures
{
    /**
     * A tenant with a finance user, a dispatcher, a vehicle, a driver, and
     * a default rate card carrying one priced version.
     *
     * Default prices are round numbers chosen so expected totals can be
     * checked by hand in the test that asserts them: base 5,000, 500/km,
     * 200/waiting minute, 10 free waiting minutes, minimum 10,000.
     *
     * @param  array<string, mixed>  $rate  overrides for the single vehicle-category rate
     * @param  array<string, mixed>  $version  overrides for the version itself
     * @return array{tenant: Tenant, finance: User, dispatcher: User, vehicle: Vehicle, driver: Driver, card: RateCard, version: RateCardVersion}
     */
    public static function tenantWithRateCard(array $rate = [], array $version = []): array
    {
        $tenant = Tenant::factory()->create();

        self::bindTenant($tenant);

        $finance = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::FINANCE]);
        $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

        $vehicle = Vehicle::factory()->create(['category' => 'sedan']);
        $driver = Driver::factory()->create();

        $card = app(RateCardService::class)->create([
            'name' => 'Standard',
            'is_default' => true,
            'version' => [
                'effective_from' => '2020-01-01',
                'rounding_mode' => 'half_up',
                'free_waiting_minutes' => 10,
                'night_starts_at' => null,
                'night_ends_at' => null,
                'night_multiplier_bp' => RateCardVersion::NO_MULTIPLIER_BP,
                'rates' => [[
                    'vehicle_category' => 'sedan',
                    'base_fare_minor' => 5_000,
                    'per_km_minor' => 500,
                    'per_waiting_minute_minor' => 200,
                    'minimum_charge_minor' => 10_000,
                    'maximum_charge_minor' => null,
                    ...$rate,
                ]],
                ...$version,
            ],
        ], $finance);

        return [
            'tenant' => $tenant,
            'finance' => $finance,
            'dispatcher' => $dispatcher,
            'vehicle' => $vehicle,
            'driver' => $driver,
            'card' => $card,
            'version' => $card->versions()->with('rates')->first(),
        ];
    }

    /**
     * Walks a new trip all the way to Trip Completed through the real state
     * machine, so it arrives at billing with a genuine timeline.
     *
     * @param  array<int, int>  $waitingPeriodSeconds  one entry per Waiting -> Trip Resumed
     *                                                 pause, each the number of seconds waited
     */
    public static function completedTrip(
        Tenant $tenant,
        User $actor,
        Vehicle $vehicle,
        Driver $driver,
        int $odometerStart = 15_000,
        int $odometerEnd = 15_042,
        array $waitingPeriodSeconds = [],
    ): Trip {
        self::bindTenant($tenant);

        $trip = app(TripService::class)->create([
            'tenant_id' => $tenant->id,
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
            'origin' => 'Kampala',
            'destination' => 'Entebbe',
        ], $actor);

        $machine = app(TripStateMachine::class);

        foreach ([
            TripStatus::ACCEPTED,
            TripStatus::DRIVER_EN_ROUTE,
            TripStatus::DRIVER_ARRIVED,
            TripStatus::PASSENGER_ONBOARD,
        ] as $to) {
            $trip = $machine->transition($trip, $to, $actor);
        }

        $trip = $machine->transition($trip, TripStatus::TRIP_STARTED, $actor, [
            'odometer_start' => $odometerStart,
        ]);

        foreach ($waitingPeriodSeconds as $seconds) {
            $trip = $machine->transition($trip, TripStatus::WAITING, $actor);

            // Travel forward so the pair of trip_events really is `$seconds`
            // apart. WaitingTimeCalculator reads those timestamps and
            // nothing else; a test that transitioned straight through would
            // measure zero and prove nothing about the waiting charge.
            test()->travel($seconds)->seconds();

            $trip = $machine->transition($trip, TripStatus::TRIP_RESUMED, $actor);
        }

        return $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, [
            'odometer_end' => $odometerEnd,
        ]);
    }

    /**
     * Binds the tenant the way seeders, jobs and console commands must.
     * TenantScope fails closed, so without this every read returns nothing
     * and the test passes without having exercised anything.
     */
    public static function bindTenant(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
    }
}
