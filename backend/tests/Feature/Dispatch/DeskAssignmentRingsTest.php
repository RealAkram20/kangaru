<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Notifications\Notifications\DriverTripAssignedNotification;
use Modules\Notifications\Notifications\TripOfferedNotification;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0068: the desk's assignment reaches a driver the same way a walk-in
 * does — it rings, and the trip exists only once they answer.
 *
 * The gap this file closes is not hypothetical. `DispatchAssignmentTest`
 * went on passing unchanged through the whole of this change, because every
 * driver it builds is a `Driver::factory()` with no `user_id` — the
 * phone-less path, which still assigns outright. A suite can be entirely
 * green about a feature it never once exercises.
 */
function deskFixture(bool $driverHasApp = true): array
{
    $tenant = Tenant::factory()->create();

    $dispatcher = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::DISPATCHER,
    ]);

    $driverUser = $driverHasApp
        ? User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER])
        : null;

    $driver = Driver::factory()->create(['user_id' => $driverUser?->id]);
    $vehicle = Vehicle::factory()->van()->create();

    $booking = Booking::factory()->forTenant($tenant)->create([
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ]);

    return compact('tenant', 'dispatcher', 'driverUser', 'driver', 'vehicle', 'booking');
}

function deskAssign(User $actor, Booking $booking, Vehicle $vehicle, Driver $driver, array $extra = [])
{
    return test()->actingAs($actor, 'sanctum')->postJson(
        "/api/v1/bookings/{$booking->id}/assignment",
        ['vehicle_id' => $vehicle->id, 'driver_id' => $driver->id, ...$extra],
    );
}

it('rings the driver instead of writing a trip', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking,
        'vehicle' => $vehicle, 'driver' => $driver] = deskFixture();

    $response = deskAssign($dispatcher, $booking, $vehicle, $driver);

    // 202, not 201: the request was accepted and a phone is ringing. The
    // thing the caller asked to create does not exist and may never.
    $response->assertStatus(202)
        ->assertJsonPath('data.status', DispatchOfferStatus::OFFERED->value)
        ->assertJsonPath('data.pickup.label', 'Kampala')
        ->assertJsonPath('data.dropoff.label', 'Entebbe Airport')
        ->assertJsonPath('data.client', $booking->tenant->name);

    expect(Trip::count())->toBe(0);

    // And the booking has *not* moved. Until somebody answers, it is still
    // the desk's to reassign — the board must not show it as done.
    expect($booking->fresh()->status)->not->toBe(BookingStatus::ASSIGNED);

    $offer = DispatchOffer::sole();
    expect($offer->booking_id)->toBe($booking->id);
    expect($offer->order_request_id)->toBeNull();
    expect($offer->driver_id)->toBe($driver->id);
    expect($offer->vehicle_id)->toBe($vehicle->id);
});

it('puts the job on the driver’s phone with the offer ringtone', function () {
    Notification::fake();

    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'driverUser' => $driverUser] = deskFixture();

    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);

    // The *same* notification a walk-in raises, which is the whole point:
    // one ring, one channel, one call screen. A second notification class
    // for the desk would be a second thing to keep in step.
    Notification::assertSentTo($driverUser, TripOfferedNotification::class);
});

it('assigns a driver with no app outright, because nothing can ring', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking,
        'vehicle' => $vehicle, 'driver' => $driver] = deskFixture(driverHasApp: false);

    deskAssign($dispatcher, $booking, $vehicle, $driver)
        ->assertStatus(201)
        ->assertJsonPath('data.status', TripStatus::ASSIGNED->value);

    expect(DispatchOffer::count())->toBe(0);
    expect($booking->fresh()->status)->toBe(BookingStatus::ASSIGNED);
});

it('writes the trip when the driver accepts, carrying the booking’s own client', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'driverUser' => $driverUser, 'tenant' => $tenant] = deskFixture();

    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);

    $offerId = DispatchOffer::sole()->id;

    /*
     * **Through the driver's own endpoint, and that is the whole point of
     * this test.**
     *
     * Calling `DispatchOfferService::accept()` directly here proves less
     * than it appears to: the dispatcher's request a moment ago bound a
     * tenant to the container, and it is still bound, so the trip acquires
     * the right client whether or not the code asks for it. Removing
     * `'tenant_id' => $booking->tenant_id` left this test green — checked by
     * mutation, which is the only reason it is written this way.
     *
     * A real accept arrives on the driver's own HTTP request, where no
     * tenant is bound at all, and `actingAs` the driver reproduces that.
     */
    test()->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/me/offers/{$offerId}/acceptance")
        ->assertStatus(201);

    // `allTenants()`, because the last request in this test was the
    // *driver's* and left no tenant bound — the very condition this test
    // exists to reproduce. Scoped, `TenantScope` would hide the trip from
    // the assertion as surely as it hid the booking from the service.
    $trip = Trip::allTenants()->sole();

    expect($trip->booking_id)->toBe($booking->id);
    expect($trip->origin)->toBe('Kampala');
    expect($trip->destination)->toBe('Entebbe Airport');

    // ADR-0068 §7, and ADR-0001's worst-available bug if it regresses: a
    // corporate trip owned by nobody, written by a route nothing watched.
    expect($trip->tenant_id)->toBe($tenant->id);

    expect($booking->fresh()->status)->toBe(BookingStatus::ASSIGNED);
    expect(DispatchOffer::sole()->status)->toBe(DispatchOfferStatus::ACCEPTED);
});

it('stops at accepted, because saying yes to Tuesday is not setting off', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'driverUser' => $driverUser] = deskFixture();

    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);

    $trip = app(DispatchOfferService::class)->accept(DispatchOffer::sole(), $driverUser);

    // A walk-in's accept runs on to `driver_en_route` — the passenger is
    // standing at a kerb. A booking may be for four o'clock, and the driver
    // presses "On my way" themselves.
    expect($trip->status)->toBe(TripStatus::ACCEPTED);
});

it('does not also tell a driver about the job they just accepted', function () {
    Notification::fake();

    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'driverUser' => $driverUser] = deskFixture();

    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);
    app(DispatchOfferService::class)->accept(DispatchOffer::sole(), $driverUser);

    // "New trip assigned to you", seconds after they pressed Accept, is the
    // notification fatigue AGENTS.md warns about (ADR-0068 §10).
    Notification::assertNotSentTo($driverUser, DriverTripAssignedNotification::class);
});

it('carries the dispatcher’s override reason across the wait onto the trip', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'driverUser' => $driverUser] = deskFixture();

    // The override has to be *real* for a reason to be recorded at all:
    // `applyAllocationRules` returns null when nothing was contracted, so a
    // reason offered where none was owed is correctly dropped. A second
    // vehicle set aside for this client is what makes choosing the first one
    // an override.
    VehicleAllocation::factory()->create([
        'tenant_id' => $booking->tenant_id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'starts_on' => now()->subDay(),
        'ends_on' => now()->addDay(),
    ]);

    deskAssign($dispatcher, $booking, $vehicle, $driver, [
        'allocation_override_reason' => 'Client asked for the van by name.',
    ])->assertStatus(202);

    $offer = DispatchOffer::sole();
    $trip = app(DispatchOfferService::class)->accept($offer, $driverUser);

    expect($trip->allocation_override_reason)->toBe('Client asked for the van by name.');
});

it('refuses a second offer while the first is still ringing', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking,
        'vehicle' => $vehicle, 'driver' => $driver] = deskFixture();

    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);
    $first = DispatchOffer::sole()->id;

    // A dispatcher pressing Assign twice, or two dispatchers at once. Either
    // gets the offer already out rather than a second front on one booking.
    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);

    expect(DispatchOffer::count())->toBe(1);
    expect(DispatchOffer::sole()->id)->toBe($first);
});

it('gives the driver the booking’s pickup pin, so the map can draw', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking, 'vehicle' => $vehicle,
        'driver' => $driver, 'driverUser' => $driverUser] = deskFixture();

    // A booking raised with a pin on it, which is what the console sends
    // when a dispatcher picks the pickup from the suggestions.
    $booking->forceFill(['origin_latitude' => 0.3476, 'origin_longitude' => 32.5825])->save();

    deskAssign($dispatcher, $booking, $vehicle, $driver)->assertStatus(202);

    $tripId = test()->actingAs($driverUser, 'sanctum')
        ->postJson('/api/v1/me/offers/'.DispatchOffer::sole()->id.'/acceptance')
        ->assertStatus(201)
        ->json('data.id');

    /*
     * Read back through the driver's own request, which is the only way
     * this bites: `TenantScope` fails closed there, so an eager-loaded
     * booking resolves to null and the coordinates vanish. `TripResource`
     * read `order_requests` alone until 29 August, so every desk-dispatched
     * trip reached the app with no pin whatever the booking held — the
     * driver's screen said "the order was taken without a pin on it" over a
     * job that had one.
     */
    $pickup = test()->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$tripId}")
        ->assertOk()
        ->json('data.pickup');

    expect($pickup['latitude'])->toBe(0.3476);
    expect($pickup['longitude'])->toBe(32.5825);
});

it('keeps a booking’s offer off the other kind of owner', function () {
    // The exclusivity `DispatchOffer::booted()` asserts. Written as a test
    // rather than trusted to the column defaults, because the failure it
    // prevents — an offer answering for two different jobs — is one that
    // would be discovered by a passenger, not by a reviewer.
    expect(fn () => DispatchOffer::create([
        'booking_id' => 1,
        'order_request_id' => 1,
        'driver_id' => 1,
        'status' => DispatchOfferStatus::OFFERED,
        'offered_at' => now(),
        'expires_at' => now()->addSeconds(45),
    ]))->toThrow(LogicException::class);
});
