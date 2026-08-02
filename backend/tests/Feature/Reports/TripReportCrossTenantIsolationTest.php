<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Storage;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Reports\Models\ReportExport;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md-mandated, non-skippable: proves ADR-0001 tenant isolation holds
 * for reports.
 *
 * Reports get their own isolation test rather than relying on the Trips one
 * because a report is an aggregate: a leak here would not show up as
 * another tenant's row appearing in a list, but as their distance and trip
 * count silently inflating this tenant's totals — invisible unless the
 * summary is asserted directly, which is what this does.
 */
function seedTwoTenantsWithReportableTrips(): array
{
    $build = function (Tenant $tenant, User $actor, int $odometerStart, int $odometerEnd): Trip {
        // Bound by hand because these services are called directly rather
        // than through the IdentifyTenant middleware. Set per tenant, so
        // each half of the fixture is genuinely built in its own context.
        app(TenantContext::class)->set($tenant->id);

        $vehicle = Vehicle::factory()->create();
        $driver = Driver::factory()->create();
        $booking = Booking::factory()->forTenant($tenant)->create();

        $trip = app(DispatchService::class)->assign($booking, $vehicle->id, $driver->id, $actor);
        $machine = app(TripStateMachine::class);

        foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED,
            TripStatus::PASSENGER_ONBOARD] as $step) {
            $machine->transition($trip, $step, $actor);
        }

        $machine->transition($trip, TripStatus::TRIP_STARTED, $actor, ['odometer_start' => $odometerStart]);
        $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, ['odometer_end' => $odometerEnd]);

        return $trip->refresh();
    };

    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $managerA = User::factory()->create(['tenant_id' => $tenantA->id, 'role' => UserRole::OPERATIONS_MANAGER]);
    $managerB = User::factory()->create(['tenant_id' => $tenantB->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    // 25 km for A, 500 km for B — far enough apart that a leak into the
    // totals cannot be mistaken for rounding.
    $tripA = $build($tenantA, $managerA, 1_000, 1_025);
    $tripB = $build($tenantB, $managerB, 5_000, 5_500);

    return compact('tenantA', 'tenantB', 'managerA', 'tripA', 'tripB');
}

it('excludes another tenant\'s trips from the report rows', function () {
    ['managerA' => $managerA, 'tripA' => $tripA, 'tripB' => $tripB] = seedTwoTenantsWithReportableTrips();

    $ids = collect(
        $this->actingAs($managerA, 'sanctum')->getJson('/api/v1/reports/trips')->json('data')
    )->pluck('trip_id');

    expect($ids)->toContain($tripA->id);
    expect($ids)->not->toContain($tripB->id);
});

it('excludes another tenant\'s trips from the report totals', function () {
    ['managerA' => $managerA] = seedTwoTenantsWithReportableTrips();

    $summary = $this->actingAs($managerA, 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertOk()
        ->json('meta.summary');

    // Tenant A drove 25 km on one trip. Tenant B's 500 km must be absent
    // from both the count and the distance.
    expect($summary['trips'])->toBe(1);
    expect((float) $summary['distance_km'])->toBe(25.0);
});

it('excludes another tenant\'s trips from a generated export file', function () {
    ['managerA' => $managerA, 'tripA' => $tripA, 'tripB' => $tripB] = seedTwoTenantsWithReportableTrips();

    Storage::fake('local');

    // QUEUE_CONNECTION is sync in tests, so the job runs inline and the
    // file exists by the time the request returns.
    $this->actingAs($managerA, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();
    $csv = Storage::get($export->path);

    expect($csv)->toContain($tripA->vehicle->registration_number);
    expect($csv)->not->toContain($tripB->vehicle->registration_number);
});

it('refuses to download another tenant\'s export with a 404, not a 403', function () {
    ['managerA' => $managerA, 'tenantB' => $tenantB] = seedTwoTenantsWithReportableTrips();

    Storage::fake('local');

    $foreign = ReportExport::allTenants()->create([
        'tenant_id' => $tenantB->id,
        'requested_by_user_id' => User::factory()->create([
            'tenant_id' => $tenantB->id, 'role' => UserRole::OPERATIONS_MANAGER,
        ])->id,
        'report' => 'trips',
        'format' => 'csv',
        'status' => 'completed',
        'filters' => [],
        'path' => 'tenants/'.$tenantB->id.'/reports/999/leak.csv',
    ]);

    Storage::put($foreign->path, 'tenant B private data');

    $this->actingAs($managerA, 'sanctum')
        ->getJson("/api/v1/reports/exports/{$foreign->id}/download")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('stores every export under its own tenant\'s directory', function () {
    ['managerA' => $managerA, 'tenantA' => $tenantA] = seedTwoTenantsWithReportableTrips();

    Storage::fake('local');

    $this->actingAs($managerA, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    // ADR-0001: "File storage paths are prefixed tenants/{id}/".
    expect($export->path)->toStartWith("tenants/{$tenantA->id}/");
});

it('ignores a vehicle_id filter pointing at another tenant\'s vehicle', function () {
    ['managerA' => $managerA, 'tripB' => $tripB] = seedTwoTenantsWithReportableTrips();

    // Filtering by a foreign id must return nothing, never that tenant's row.
    $response = $this->actingAs($managerA, 'sanctum')
        ->getJson("/api/v1/reports/trips?vehicle_id={$tripB->vehicle_id}")
        ->assertOk();

    expect($response->json('data'))->toBeEmpty();
    expect($response->json('meta.summary.trips'))->toBe(0);
});
