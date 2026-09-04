<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * Every value here comes from a factory rather than a literal, so calling
 * this twice inside one test builds two genuinely independent tenants —
 * the hardcoded slug/registration/licence literals it replaced collided on
 * their unique indexes the moment a second fixture was requested.
 */
function seedTripStateMachineFixture(): array
{
    $tenant = Tenant::factory()->create();

    $vehicle = Vehicle::factory()->van()->create();
    $otherVehicle = Vehicle::factory()->create();

    $driver = Driver::factory()->create();
    $otherDriver = Driver::factory()->create();

    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle($vehicle)
        ->forDriver($driver)
        ->create(['destination' => 'Entebbe']);

    // TripFactory deliberately writes no timeline; the opening event is
    // TripService::create()'s job, mirrored here so event counts below
    // start from a realistic trip.
    TripEvent::create([
        'tenant_id' => $tenant->id, 'trip_id' => $trip->id, 'from_status' => null,
        'to_status' => TripStatus::ASSIGNED, 'user_id' => null, 'notes' => null,
    ]);

    return compact('tenant', 'vehicle', 'otherVehicle', 'driver', 'otherDriver', 'dispatcher', 'trip');
}

/**
 * Applies the one transition no HTTP client may ask for.
 *
 * `TransitionTripRequest` rejects `to=invoice_generated` with a 422, because
 * Modules\Billing owns that state: InvoiceService applies it inside the
 * transaction that issues the invoice, so a trip can never be marked billed
 * without an invoice behind it. These lifecycle tests still need to get past
 * it, and calling the state machine directly is exactly what Billing does —
 * without dragging a rate card fixture into a Trips test.
 */
function invoiceGeneratedByBilling(User $actor, Trip $trip): void
{
    app(TripStateMachine::class)->transition($trip->fresh(), TripStatus::INVOICE_GENERATED, $actor);
}

/**
 * Walks a freshly-Assigned trip through to Passenger Onboard — the
 * common prefix several tests need before exercising Trip Started.
 */
function driveTripToPassengerOnboard(User $dispatcher, Trip $trip): void
{
    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED, TripStatus::PASSENGER_ONBOARD] as $to) {
        test()->actingAs($dispatcher, 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => $to->value])
            ->assertOk();
    }
}

it('applies a valid transition and writes a trip event', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::ACCEPTED->value]);

    $response->assertOk()->assertJsonPath('data.status', TripStatus::ACCEPTED->value);
    expect($trip->fresh()->status)->toBe(TripStatus::ACCEPTED);
    expect(TripEvent::where('trip_id', $trip->id)->count())->toBe(2);
});

it('rejects an illegal transition with 409 INVALID_TRIP_TRANSITION and leaves state unchanged', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value,
            'odometer_start' => 1000,
        ]);

    $response->assertStatus(409)->assertJsonPath('code', 'INVALID_TRIP_TRANSITION');
    expect($trip->fresh()->status)->toBe(TripStatus::ASSIGNED);
    expect(TripEvent::where('trip_id', $trip->id)->count())->toBe(1);
});

it('requires odometer_start to reach Trip Started', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::TRIP_STARTED->value])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('captures the opening odometer and started_at on Trip Started', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value,
            'odometer_start' => 15000,
        ])->assertOk();

    $fresh = $trip->fresh();
    expect($fresh->odometer_start)->toBe(15000);
    expect($fresh->started_at)->not->toBeNull();
});

it('requires odometer_end to reach Trip Completed and computes distance_km', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value, 'odometer_start' => 15000,
        ])->assertOk();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::TRIP_COMPLETED->value])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value, 'odometer_end' => 15042,
        ])->assertOk();

    $fresh = $trip->fresh();
    expect((float) $fresh->distance_km)->toBe(42.0);
    expect($fresh->completed_at)->not->toBeNull();
});

it('reports all six of the Bank\'s acceptance criteria on a completed trip', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip, 'vehicle' => $vehicle] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);

    $this->travelTo(now()->subMinutes(90));
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value, 'odometer_start' => 15000,
        ])->assertOk();

    $this->travelBack();
    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value, 'odometer_end' => 15042,
        ])->assertOk();

    // PROJECT.md "Anchor Client Requirement", items 1-6.
    $response
        ->assertJsonPath('data.vehicle.registration_number', $vehicle->registration_number)
        ->assertJsonPath('data.origin', 'Kampala')
        ->assertJsonPath('data.destination', 'Entebbe')
        ->assertJsonPath('data.odometer_start', 15000)
        ->assertJsonPath('data.odometer_end', 15042)
        ->assertJsonPath('data.duration_minutes', 90);

    expect($response->json('data.started_at'))->not->toBeNull();
    expect($response->json('data.completed_at'))->not->toBeNull();
    expect((float) $response->json('data.distance_km'))->toBe(42.0);
});

it('serves the legal next states so clients need no copy of the graph', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        // Exactly TripStatus::ASSIGNED->allowedTransitions().
        ->assertJsonPath('data.allowed_transitions', ['accepted', 'rejected', 'cancelled']);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::CANCELLED->value, 'notes' => 'x'])
        ->assertOk()
        // A terminal state offers nothing.
        ->assertJsonPath('data.allowed_transitions', []);
});

it('serves the pickup waiting target from configuration, not from a literal', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    // Set to something no reasonable default would collide with, so a
    // hardcoded 300 in the resource fails this rather than passing by
    // coincidence.
    config(['dispatch.pickup_wait_target_seconds' => 137]);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.pickup_wait_target_seconds', 137);
});

it('does not let the waiting target change any trip state when it elapses', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    // The claim `config/dispatch.php` and the contract both make: this
    // number is a display target and has no consequence. A trip parked at
    // Driver Arrived for ten times the target is still at Driver Arrived,
    // and still offers exactly the same moves.
    $this->actingAs($dispatcher, 'sanctum')->postJson("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::ACCEPTED->value,
    ])->assertOk();
    $this->actingAs($dispatcher, 'sanctum')->postJson("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::DRIVER_EN_ROUTE->value,
    ])->assertOk();
    $this->actingAs($dispatcher, 'sanctum')->postJson("/api/v1/trips/{$trip->id}/transitions", [
        'to' => TripStatus::DRIVER_ARRIVED->value,
    ])->assertOk();

    config(['dispatch.pickup_wait_target_seconds' => 60]);

    $this->travel(600)->seconds();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.status', TripStatus::DRIVER_ARRIVED->value)
        ->assertJsonPath('data.allowed_transitions', ['passenger_onboard', 'no_show', 'cancelled']);
});

it('reports no duration until the trip has both started and completed', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.duration_minutes', null);
});

it('rejects a closing odometer reading lower than the opening reading', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value, 'odometer_start' => 15000,
        ])->assertOk();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::TRIP_COMPLETED->value, 'odometer_end' => 14000,
        ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('allows Cancelled before Trip Started but blocks it once the trip has started', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::CANCELLED->value, 'notes' => 'Client cancelled'])
        ->assertOk();
    expect($trip->fresh()->status)->toBe(TripStatus::CANCELLED);

    ['dispatcher' => $dispatcher2, 'trip' => $trip2] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher2, $trip2);
    $this->actingAs($dispatcher2, 'sanctum')
        ->postJson("/api/v1/trips/{$trip2->id}/transitions", [
            'to' => TripStatus::TRIP_STARTED->value, 'odometer_start' => 15000,
        ])->assertOk();

    $this->actingAs($dispatcher2, 'sanctum')
        ->postJson("/api/v1/trips/{$trip2->id}/transitions", ['to' => TripStatus::CANCELLED->value, 'notes' => 'Too late'])
        ->assertStatus(409)->assertJsonPath('code', 'INVALID_TRIP_TRANSITION');
});

it('walks the full happy path from Assigned to Closed with a correctly ordered timeline', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);

    $steps = [
        [TripStatus::TRIP_STARTED, ['odometer_start' => 15000]],
        [TripStatus::TRIP_COMPLETED, ['odometer_end' => 15050]],
    ];

    foreach ($steps as [$to, $extra]) {
        $this->actingAs($dispatcher, 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => $to->value, ...$extra])
            ->assertOk();
    }

    // Invoice Generated has no HTTP transition — it belongs to
    // Modules\Billing, which applies it in the same transaction that issues
    // the invoice. Driven through the state machine directly here so this
    // test stays about the trip lifecycle and does not need a rate card.
    invoiceGeneratedByBilling($dispatcher, $trip);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::CLOSED->value])
        ->assertOk();

    expect($trip->fresh()->status)->toBe(TripStatus::CLOSED);

    // Initial Assigned + 4 prefix transitions + 4 steps above = 9 events.
    $events = TripEvent::where('trip_id', $trip->id)->orderBy('created_at')->orderBy('id')->get();
    expect($events)->toHaveCount(9);

    $expectedSequence = [
        TripStatus::ASSIGNED, TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD, TripStatus::TRIP_STARTED, TripStatus::TRIP_COMPLETED,
        TripStatus::INVOICE_GENERATED, TripStatus::CLOSED,
    ];
    expect($events->pluck('to_status')->map(fn ($s) => $s->value)->toArray())
        ->toEqual(collect($expectedSequence)->map(fn ($s) => $s->value)->toArray());
});

it('lets a dispatcher reassign the driver/vehicle when moving Rejected back to Assigned', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip, 'otherDriver' => $otherDriver] = seedTripStateMachineFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::REJECTED->value, 'notes' => 'Driver declined'])
        ->assertOk();
    expect($trip->fresh()->status)->toBe(TripStatus::REJECTED);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => TripStatus::ASSIGNED->value,
            'driver_id' => $otherDriver->id,
        ])->assertOk();

    $fresh = $trip->fresh();
    expect($fresh->status)->toBe(TripStatus::ASSIGNED);
    expect($fresh->driver_id)->toBe($otherDriver->id);
});

it('only allows Disputed from Invoice Generated, and only Closed from Disputed', function () {
    ['dispatcher' => $dispatcher, 'trip' => $trip] = seedTripStateMachineFixture();
    driveTripToPassengerOnboard($dispatcher, $trip);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::DISPUTED->value, 'notes' => 'x'])
        ->assertStatus(409)->assertJsonPath('code', 'INVALID_TRIP_TRANSITION');

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::TRIP_STARTED->value, 'odometer_start' => 15000])
        ->assertOk();
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::TRIP_COMPLETED->value, 'odometer_end' => 15010])
        ->assertOk();
    invoiceGeneratedByBilling($dispatcher, $trip);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::DISPUTED->value, 'notes' => 'Amount disputed'])
        ->assertOk();
    expect($trip->fresh()->status)->toBe(TripStatus::DISPUTED);

    // Closing a disputed trip requires resolution notes.
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::CLOSED->value])
        ->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => TripStatus::CLOSED->value, 'notes' => 'Resolved via credit note'])
        ->assertOk();
    expect($trip->fresh()->status)->toBe(TripStatus::CLOSED);
});
