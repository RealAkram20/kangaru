<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

function seedDispatchFixture(): array
{
    $tenant = Tenant::factory()->create();

    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $vehicle = Vehicle::factory()->van()->create();
    $otherVehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create();
    $otherDriver = Driver::factory()->create();

    $booking = Booking::factory()->forTenant($tenant)->create([
        'origin' => 'Kampala', 'destination' => 'Entebbe Airport',
    ]);

    return compact('tenant', 'dispatcher', 'employee', 'vehicle', 'otherVehicle', 'driver', 'otherDriver', 'booking');
}

function assign(User $actor, Booking $booking, Vehicle $vehicle, Driver $driver)
{
    return test()->actingAs($actor, 'sanctum')->postJson("/api/v1/bookings/{$booking->id}/assignment", [
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
    ]);
}

it('turns a booking into an Assigned trip carrying the booking\'s route', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver] = seedDispatchFixture();

    $response = assign($dispatcher, $booking, $vehicle, $driver);

    $response->assertStatus(201)
        ->assertJsonPath('data.status', TripStatus::ASSIGNED->value)
        ->assertJsonPath('data.booking_id', $booking->id)
        ->assertJsonPath('data.origin', 'Kampala')
        ->assertJsonPath('data.destination', 'Entebbe Airport')
        ->assertJsonPath('data.vehicle.id', $vehicle->id)
        ->assertJsonPath('data.driver.id', $driver->id);

    expect($booking->fresh()->status)->toBe(BookingStatus::ASSIGNED);
});

it('opens the trip timeline with a single Assigned event', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver] = seedDispatchFixture();

    $tripId = assign($dispatcher, $booking, $vehicle, $driver)->json('data.id');

    $events = TripEvent::where('trip_id', $tripId)->get();

    expect($events)->toHaveCount(1);
    expect($events->first()->from_status)->toBeNull();
    expect($events->first()->to_status)->toBe(TripStatus::ASSIGNED);
    expect($events->first()->user_id)->toBe($dispatcher->id);
});

it('refuses to dispatch the same booking twice with 409', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver,
        'otherVehicle' => $otherVehicle, 'otherDriver' => $otherDriver] = seedDispatchFixture();

    assign($dispatcher, $booking, $vehicle, $driver)->assertStatus(201);

    assign($dispatcher, $booking, $otherVehicle, $otherDriver)
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVALID_BOOKING_TRANSITION');

    expect(Trip::where('booking_id', $booking->id)->count())->toBe(1);
});

it('refuses a vehicle already committed to a live trip with 409 VEHICLE_UNAVAILABLE', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'otherDriver' => $otherDriver] = seedDispatchFixture();

    assign($dispatcher, $booking, $vehicle, $driver)->assertStatus(201);

    $secondBooking = Booking::factory()->forTenant($tenant)->create();

    assign($dispatcher, $secondBooking, $vehicle, $otherDriver)
        ->assertStatus(409)
        ->assertJsonPath('code', 'VEHICLE_UNAVAILABLE');

    // The losing attempt must leave nothing behind — no half-dispatched
    // booking, no orphan trip.
    expect($secondBooking->fresh()->status)->toBe(BookingStatus::PENDING);
    expect(Trip::where('booking_id', $secondBooking->id)->count())->toBe(0);
});

it('refuses a driver already committed to a live trip with 409 DRIVER_UNAVAILABLE', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'otherVehicle' => $otherVehicle] = seedDispatchFixture();

    assign($dispatcher, $booking, $vehicle, $driver)->assertStatus(201);

    $secondBooking = Booking::factory()->forTenant($tenant)->create();

    assign($dispatcher, $secondBooking, $otherVehicle, $driver)
        ->assertStatus(409)
        ->assertJsonPath('code', 'DRIVER_UNAVAILABLE');
});

it('frees the vehicle again once its trip is completed', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver] = seedDispatchFixture();

    $tripId = assign($dispatcher, $booking, $vehicle, $driver)->json('data.id');

    $steps = [
        [TripStatus::ACCEPTED, []],
        [TripStatus::DRIVER_EN_ROUTE, []],
        [TripStatus::DRIVER_ARRIVED, []],
        [TripStatus::PASSENGER_ONBOARD, []],
        [TripStatus::TRIP_STARTED, ['odometer_start' => 1000]],
        [TripStatus::TRIP_COMPLETED, ['odometer_end' => 1040]],
    ];

    foreach ($steps as [$to, $extra]) {
        $this->actingAs($dispatcher, 'sanctum')
            ->postJson("/api/v1/trips/{$tripId}/transitions", ['to' => $to->value, ...$extra])
            ->assertOk();
    }

    // Occupancy ends at Trip Completed even though billing states follow.
    $nextBooking = Booking::factory()->forTenant($tenant)->create();

    assign($dispatcher, $nextBooking, $vehicle, $driver)->assertStatus(201);
});

it('frees the vehicle again once its trip is cancelled', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver] = seedDispatchFixture();

    $tripId = assign($dispatcher, $booking, $vehicle, $driver)->json('data.id');

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$tripId}/transitions", [
            'to' => TripStatus::CANCELLED->value, 'notes' => 'Passenger no longer travelling.',
        ])->assertOk();

    $nextBooking = Booking::factory()->forTenant($tenant)->create();

    assign($dispatcher, $nextBooking, $vehicle, $driver)->assertStatus(201);
});

it('dispatches an approved booking as readily as a pending one', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver] = seedDispatchFixture();

    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/approval")
        ->assertOk();

    assign($dispatcher, $booking, $vehicle, $driver)->assertStatus(201);
});

it('refuses to dispatch a cancelled booking with 409', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver] = seedDispatchFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/cancellation", ['reason' => 'Client withdrew.'])
        ->assertOk();

    assign($dispatcher, $booking, $vehicle, $driver)
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVALID_BOOKING_TRANSITION');
});

it('forbids a corporate employee from dispatching', function () {
    ['employee' => $employee, 'booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver] = seedDispatchFixture();

    assign($employee, $booking, $vehicle, $driver)
        ->assertStatus(403)
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('blocks ad-hoc trip creation on a vehicle that is already out', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'otherDriver' => $otherDriver] = seedDispatchFixture();

    assign($dispatcher, $booking, $vehicle, $driver)->assertStatus(201);

    // POST /trips is the second assignment path; it must honour the same
    // invariant as dispatch, or the guarantee is worthless.
    $this->actingAs($dispatcher, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $vehicle->id,
        'driver_id' => $otherDriver->id,
        'origin' => 'Kampala',
        'destination' => 'Jinja',
    ])->assertStatus(409)->assertJsonPath('code', 'VEHICLE_UNAVAILABLE');
});

it('blocks reassignment onto a vehicle that has been taken since the rejection', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'otherVehicle' => $otherVehicle, 'driver' => $driver, 'otherDriver' => $otherDriver] = seedDispatchFixture();

    $tripId = assign($dispatcher, $booking, $vehicle, $driver)->json('data.id');

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$tripId}/transitions", [
            'to' => TripStatus::REJECTED->value, 'notes' => 'Driver declined.',
        ])->assertOk();

    // While it sat rejected, another booking took otherVehicle.
    $secondBooking = Booking::factory()->forTenant($tenant)->create();
    assign($dispatcher, $secondBooking, $otherVehicle, $otherDriver)->assertStatus(201);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$tripId}/transitions", [
            'to' => TripStatus::ASSIGNED->value,
            'vehicle_id' => $otherVehicle->id,
        ])->assertStatus(409)->assertJsonPath('code', 'VEHICLE_UNAVAILABLE');
});
