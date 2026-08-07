<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Trips\Models\Trip;
use Modules\Trips\Support\LivePosition;
use Modules\Trips\Support\LivePositionStore;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0020 — the matcher.
 *
 * PROJECT.md moved automatic dispatch into Phase 1 by owner approval on
 * 2 August 2026; `Modules/Dispatch/README.md` has carried it as deferred
 * item 1 ever since, blocked on availability (ADR-0017) and live positions
 * (ADR-0019).
 *
 * What matters here is that the matcher never offers something the
 * assignment endpoint would refuse, that its reasons are readable, and that
 * committing goes through the same locked path a human uses.
 */
function autoDispatcher(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
}

function bookingAt(Tenant $tenant, ?float $lat = null, ?float $lng = null, int $passengers = 2): Booking
{
    return Booking::factory()->forTenant($tenant)->create([
        'scheduled_for' => null,
        'passenger_count' => $passengers,
        'origin_latitude' => $lat,
        'origin_longitude' => $lng,
        'status' => 'approved',
    ]);
}

function parkVehicleAt(Vehicle $vehicle, Tenant $tenant, float $lat, float $lng): void
{
    // A vehicle only has a live position because it is on a trip; the
    // matcher reads the position, not the trip, so a completed one is used
    // here to avoid making the vehicle look busy.
    $trip = Trip::factory()->forTenant($tenant)->forVehicle($vehicle)
        ->forDriver(Driver::factory()->create())->create(['status' => 'trip_completed']);

    app(LivePositionStore::class)->put([new LivePosition(
        vehicleId: $vehicle->id,
        tenantId: $tenant->id,
        tripId: $trip->id,
        driverId: $trip->driver_id,
        latitude: $lat,
        longitude: $lng,
        speedKph: null,
        headingDegrees: null,
        recordedAt: CarbonImmutable::now(),
    )]);
}

function recommendations(User $actor, Booking $booking): array
{
    return test()->actingAs($actor, 'sanctum')
        ->getJson("/api/v1/bookings/{$booking->id}/recommendation")
        ->assertOk()
        ->json('data');
}

// ── Ranking ──────────────────────────────────────────────────────────────

it('prefers the nearer vehicle when the pickup has coordinates', function () {
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();

    // Kampala city centre.
    $booking = bookingAt($tenant, 0.3476, 32.5825);

    // The FAR one is created first on purpose. Vehicles come back in id
    // order, and `sortByDesc` is stable — so if distance contributed
    // nothing, this one would still rank top and the test would pass for
    // the wrong reason. It did, in the first version of this file, and only
    // a mutation run caught it.
    $far = Vehicle::factory()->create(['registration_number' => 'UBB 222B', 'seating_capacity' => 5]);
    $near = Vehicle::factory()->create(['registration_number' => 'UAA 111A', 'seating_capacity' => 5]);

    parkVehicleAt($far, $tenant, 0.4500, 32.7000);    // ~17 km
    parkVehicleAt($near, $tenant, 0.3500, 32.5850);   // ~400 m

    $rows = recommendations(autoDispatcher(), $booking);

    expect($rows[0]['vehicle']['registration_number'])->toBe('UAA 111A');
    expect($rows[0]['pickup_distance_km'])->toBeLessThan(1.0);
    // The reason is the point: a ranking nobody can audit is one a
    // dispatcher overrides on instinct.
    expect(implode(' ', $rows[0]['reasons']))->toContain('km from the pickup');
});

it('says why distance was not used rather than inventing one', function () {
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);

    // A booking taken over the phone has no coordinates.
    $booking = bookingAt($tenant);

    $rows = recommendations(autoDispatcher(), $booking);

    expect($rows[0]['pickup_distance_km'])->toBeNull();
    expect(implode(' ', $rows[0]['reasons']))->toContain('no coordinates');
});

it('ranks a contracted vehicle above a nearer one, because a contract outranks a heuristic', function () {
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();

    $booking = bookingAt($tenant, 0.3476, 32.5825);

    // Nearer created first, so id order and distance both favour it — only
    // the contract can put the other on top.
    $nearer = Vehicle::factory()->create(['registration_number' => 'UDD 444D', 'seating_capacity' => 5]);
    $contracted = Vehicle::factory()->create(['registration_number' => 'UCC 333C', 'seating_capacity' => 5]);

    parkVehicleAt($nearer, $tenant, 0.3480, 32.5830);      // next door
    parkVehicleAt($contracted, $tenant, 0.4500, 32.7000);  // far

    VehicleAllocation::factory()->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $contracted->id,
        'starts_on' => now()->subDay(),
        'ends_on' => now()->addDay(),
    ]);

    $rows = recommendations(autoDispatcher(), $booking);

    // A client who paid to have vehicles set aside should get them; a
    // matcher quietly preferring a closer van would override a commercial
    // agreement on a distance heuristic.
    expect($rows[0]['vehicle']['registration_number'])->toBe('UCC 333C');
    expect(implode(' ', $rows[0]['reasons']))->toContain('Contracted');
});

// ── Hard filters ─────────────────────────────────────────────────────────

it('never offers a vehicle too small for the booking', function () {
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();

    Vehicle::factory()->create(['registration_number' => 'SMALL', 'seating_capacity' => 4]);
    Vehicle::factory()->create(['registration_number' => 'BIG', 'seating_capacity' => 12]);

    $rows = recommendations(autoDispatcher(), bookingAt($tenant, null, null, passengers: 8));

    // A hard filter, not a penalty: ranking it low would still eventually
    // offer it on a thin morning.
    expect(collect($rows)->pluck('vehicle.registration_number'))->not->toContain('SMALL');
    expect(collect($rows)->pluck('vehicle.registration_number'))->toContain('BIG');
});

it('never offers a driver on approved leave', function () {
    $tenant = Tenant::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);

    $onLeave = Driver::factory()->create(['name' => 'Aaa OnLeave']);
    AvailabilityBlock::factory()->forDriver($onLeave)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $rows = recommendations(autoDispatcher(), bookingAt($tenant));

    // Offering a candidate the assignment endpoint would 409 is worse than
    // offering fewer.
    expect(collect($rows)->pluck('driver.name'))->not->toContain('Aaa OnLeave');
});

it('never offers a vehicle in the workshop', function () {
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();

    $blocked = Vehicle::factory()->create(['registration_number' => 'WORKSHOP', 'seating_capacity' => 5]);
    Vehicle::factory()->create(['registration_number' => 'READY', 'seating_capacity' => 5]);

    AvailabilityBlock::factory()->forVehicle($blocked)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $rows = recommendations(autoDispatcher(), bookingAt($tenant));

    expect(collect($rows)->pluck('vehicle.registration_number'))->not->toContain('WORKSHOP');
});

it('offers nothing rather than something unusable when the fleet is committed', function () {
    $tenant = Tenant::factory()->create();

    $rows = recommendations(autoDispatcher(), bookingAt($tenant));

    expect($rows)->toBeEmpty();
});

// ── The flag, and committing ─────────────────────────────────────────────

it('refuses to auto-assign while the flag is off, which is the default', function () {
    config()->set('dispatch.automatic_enabled', false);

    $tenant = Tenant::factory()->create();
    Driver::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);
    $booking = bookingAt($tenant);

    $this->actingAs(autoDispatcher(), 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")
        ->assertStatus(409)
        ->assertJsonPath('code', 'AUTOMATIC_DISPATCH_DISABLED');

    expect($booking->fresh()->status->value)->toBe('approved');
});

it('commits the top suggestion through the same locked path a human uses', function () {
    config()->set('dispatch.automatic_enabled', true);

    $tenant = Tenant::factory()->create();
    $driver = Driver::factory()->create();
    $vehicle = Vehicle::factory()->create(['seating_capacity' => 5]);
    $booking = bookingAt($tenant);

    $trip = $this->actingAs(autoDispatcher(), 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")
        ->assertCreated()
        ->json('data');

    expect($trip['vehicle_id'])->toBe($vehicle->id);
    expect($trip['driver_id'])->toBe($driver->id);
    // A matcher with its own assignment path would be a second way to write
    // a trip, and the race guarantee is only as good as its narrowest path.
    expect($booking->fresh()->status->value)->toBe('assigned');
});

it('says nothing can take it rather than assigning something that cannot', function () {
    config()->set('dispatch.automatic_enabled', true);

    $tenant = Tenant::factory()->create();
    $booking = bookingAt($tenant);

    $this->actingAs(autoDispatcher(), 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")
        ->assertStatus(409)
        ->assertJsonPath('code', 'NO_DISPATCH_CANDIDATE');
});

it('still refuses a booking that is already assigned', function () {
    config()->set('dispatch.automatic_enabled', true);

    $tenant = Tenant::factory()->create();
    Driver::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);
    $booking = bookingAt($tenant);
    $booking->update(['status' => 'assigned']);

    $this->actingAs(autoDispatcher(), 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVALID_BOOKING_TRANSITION');
});

// ── Authorization ────────────────────────────────────────────────────────

it('requires a signed-in caller', function () {
    $booking = bookingAt(Tenant::factory()->create());

    $this->getJson("/api/v1/bookings/{$booking->id}/recommendation")->assertUnauthorized();
    $this->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")->assertUnauthorized();
});

it('is gated on the same ability as the assignment it replaces', function () {
    $tenant = Tenant::factory()->create();
    $booking = bookingAt($tenant);

    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $this->actingAs($employee, 'sanctum')
        ->getJson("/api/v1/bookings/{$booking->id}/recommendation")
        ->assertForbidden();

    $this->actingAs($employee, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")
        ->assertForbidden();
});
