<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Modules\Administration\Services\SettingsService;
use Modules\Clients\Models\ClientPlace;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Trips\Models\TripStop;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0045 §2 + §4, the driver slice: a live run may grow a stop, the
 * arrive/continue stamps ride `waiting ⇄ trip_resumed`, and the search over
 * the client's register is bounded to the driver currently on the trip.
 */
function seedTripStopFixture(TripStatus $status = TripStatus::TRIP_STARTED): array
{
    $tenant = Tenant::factory()->create();
    $vehicle = Vehicle::factory()->create();

    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle($vehicle)
        ->forDriver($driver)
        ->create(['status' => $status, 'destination' => 'Head Office']);

    $place = ClientPlace::factory()->forTenant($tenant)->at(0.3312, 32.5811)->create(['name' => 'Ntinda ATM']);

    return compact('tenant', 'vehicle', 'driverUser', 'driver', 'trip', 'place');
}

it('lets the driver add a free-text stop to a running trip, flagged and counted', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Bugolobi branch'])
        ->assertStatus(201)
        ->assertJsonPath('data.label', 'Bugolobi branch')
        ->assertJsonPath('data.sequence', 1)
        ->assertJsonPath('data.source', 'added_by_driver')
        ->assertJsonPath('data.status', 'pending')
        ->assertJsonPath('data.latitude', null);

    expect($trip->fresh()->unplanned_stop_count)->toBe(1);
});

it('copies the label and pin from the register on a saved-place pick', function () {
    ['driverUser' => $driverUser, 'trip' => $trip, 'place' => $place] = seedTripStopFixture();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", [
            'client_place_id' => $place->id,
            // A handset must not be able to mislabel an ATM: the register's
            // name wins over anything sent beside the id.
            'label' => 'whatever the app said',
        ])
        ->assertStatus(201)
        ->assertJsonPath('data.label', 'Ntinda ATM')
        ->assertJsonPath('data.latitude', 0.3312)
        ->assertJsonPath('data.longitude', 32.5811)
        ->assertJsonPath('data.client_place_id', $place->id);
});

it('refuses another client\'s place in one masked sentence', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();
    $foreign = ClientPlace::factory()->create();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['client_place_id' => $foreign->id])
        ->assertStatus(422)
        ->assertJsonValidationErrors('client_place_id');

    expect(TripStop::query()->forTrip($trip->fresh())->count())->toBe(0);
});

it('refuses a driver who is not on the trip', function () {
    ['trip' => $trip] = seedTripStopFixture();
    $otherUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $otherUser->id]);

    $this->actingAs($otherUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Anywhere'])
        ->assertStatus(403);
});

it('answers 409 TRIP_NOT_ACTIVE outside the journey statuses', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture(TripStatus::ACCEPTED);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Too early'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_NOT_ACTIVE');
});

it('refuses half a coordinate pair', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Half a pin', 'latitude' => 0.31])
        ->assertStatus(422)
        ->assertJsonValidationErrors('longitude');
});

it('stamps an office addition added_by_dispatch and does not count it unplanned', function () {
    ['tenant' => $tenant, 'trip' => $trip] = seedTripStopFixture();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Office says here too'])
        ->assertStatus(201)
        ->assertJsonPath('data.source', 'added_by_dispatch');

    expect($trip->fresh()->unplanned_stop_count)->toBe(0);
});

it('appends sequence per trip, and serves the itinerary on the trip payload', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'First'])->assertStatus(201);
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Second'])->assertStatus(201)
        ->assertJsonPath('data.sequence', 2);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.stops.0.label', 'First')
        ->assertJsonPath('data.stops.1.label', 'Second')
        ->assertJsonPath('data.unplanned_stop_count', 2);
});

it('marks a stop arrived on the pause that names it, and closes it on the resume', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();

    $stopId = $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Ntinda ATM'])
        ->json('data.id');

    // Arrive: the pause carries the stop (§2's table, verbatim).
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::WAITING->value,
            'stop_id' => $stopId,
        ])->assertOk();

    $stop = TripStop::query()->forTrip($trip->fresh())->first();
    expect($stop->status->value)->toBe('arrived');
    expect($stop->arrived_at)->not->toBeNull();
    expect($stop->departed_at)->toBeNull();

    // The timeline row names the stop, and says so in words. Queried through
    // `forTrip` — the bare query is the TenantScope trap this codebase keeps
    // documenting: no tenant bound in a test process means `1 = 0`.
    $event = TripEvent::query()->forTrip($trip->fresh())
        ->where('to_status', TripStatus::WAITING)->first();
    expect($event->stop_id)->toBe($stop->id);
    expect($event->notes)->toContain('Arrived at Ntinda ATM.');

    // Continue: the resume closes whichever stop is open — no stop_id needed.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::TRIP_RESUMED->value])
        ->assertOk();

    $stop = $stop->fresh();
    expect($stop->status->value)->toBe('done');
    expect($stop->departed_at)->not->toBeNull();
});

it('leaves a plain pause plain — no stop is touched without a stop_id', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Later'])->assertStatus(201);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::WAITING->value])
        ->assertOk();

    expect(TripStop::query()->forTrip($trip->fresh())->first()->status->value)->toBe('pending');
});

it('rejects a stop_id on anything but a pause, and another trip\'s stop on one', function () {
    ['driverUser' => $driverUser, 'trip' => $trip, 'tenant' => $tenant, 'vehicle' => $vehicle, 'driver' => $driver] = seedTripStopFixture();

    $stopId = $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Mine'])
        ->json('data.id');

    // Not a pause: the arrive is the pause, the departure is the resume.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_RESUMED->value,
            'stop_id' => $stopId,
        ])->assertStatus(422)->assertJsonValidationErrors('stop_id');

    // Another trip's stop, one masked sentence.
    $otherTrip = Trip::factory()->forTenant($tenant)->forVehicle($vehicle)->forDriver($driver)
        ->create(['status' => TripStatus::TRIP_STARTED]);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$otherTrip->id}/transitions", [
            'to' => TripStatus::WAITING->value,
            'stop_id' => $stopId,
        ])->assertStatus(422)->assertJsonValidationErrors('stop_id');
});

it('leaves an unvisited stop pending when the run ends before the itinerary does', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedTripStopFixture();

    // The reading gates completion by default; this test is about the stop.
    app(SettingsService::class)->setGroup('tracking', ['odometer_enabled' => false]);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['label' => 'Never reached'])
        ->assertStatus(201);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::TRIP_COMPLETED->value])
        ->assertOk();

    // Evidence, not a loose end: the record says the run deviated from its
    // own itinerary, which is exactly what §4 wants visible.
    $stop = TripStop::query()->forTrip($trip->fresh())->first();
    expect($stop->status->value)->toBe('pending');
    expect($stop->departed_at)->toBeNull();
});

it('serves the driver the trip\'s own client\'s places, filtered, and nobody else\'s', function () {
    ['driverUser' => $driverUser, 'trip' => $trip, 'tenant' => $tenant] = seedTripStopFixture();
    ClientPlace::factory()->forTenant($tenant)->create(['name' => 'Kireka branch']);
    // Another client's estate must never appear here (§10, security-gate F2).
    ClientPlace::factory()->create(['name' => 'Ntinda ATM other bank']);
    // A retired pin is not a destination.
    ClientPlace::factory()->forTenant($tenant)->create(['name' => 'Ntinda ATM retired', 'is_active' => false]);

    $names = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/stop-candidates?q=Ntinda")
        ->assertOk()
        ->json('data.*.name');

    expect($names)->toBe(['Ntinda ATM']);
});

it('closes the search to everyone but the trip\'s driver, and outside the run', function () {
    ['trip' => $trip, 'tenant' => $tenant, 'driverUser' => $driverUser] = seedTripStopFixture();

    $otherUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $otherUser->id]);

    $this->actingAs($otherUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/stop-candidates")
        ->assertStatus(403);

    // Even a dispatcher: the office reads the register through /places.
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/stop-candidates")
        ->assertStatus(403);

    // And not between jobs (§10: "none at all when they are between jobs").
    ['driverUser' => $idleUser, 'trip' => $idleTrip] = seedTripStopFixture(TripStatus::ACCEPTED);
    $this->actingAs($idleUser, 'sanctum')
        ->getJson("/api/v1/trips/{$idleTrip->id}/stop-candidates")
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_NOT_ACTIVE');
});

it('answers a walk-in trip\'s search with an empty list, not an error', function () {
    $customer = Customer::factory()->create();
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($driver)
        ->create(['status' => TripStatus::TRIP_STARTED]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/stop-candidates?q=ATM")
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('routes the fare leg to the next pending stop once one exists', function () {
    ['driverUser' => $driverUser, 'trip' => $trip, 'place' => $place] = seedTripStopFixture();

    app(SettingsService::class)->setGroup('maps', [
        'routing_enabled' => true,
        'routing_provider' => 'osrm',
        'osrm_base_url' => 'https://osrm.test',
    ]);
    Http::fake(['osrm.test/*' => Http::response(['code' => 'NoRoute', 'routes' => []])]);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/stops", ['client_place_id' => $place->id])
        ->assertStatus(201);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude=0.3949&from_longitude=32.7022")
        ->assertOk();

    // OSRM speaks longitude-first: origin is the driver's fix, destination
    // is the stop's pin — a corporate trip that had no route at all before.
    Http::assertSent(fn ($request) => str_contains($request->url(), '32.7022,0.3949;32.5811,0.3312'));
});
