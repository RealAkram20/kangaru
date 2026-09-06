<?php

use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Notification;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Notifications\Notifications\TripOfferedNotification;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * An approved booking looks for a driver by itself.
 *
 * The gap this closes was reported from production on 6 September: creating a
 * booking approved it, and the desk still had to open Dispatch and choose the
 * vehicle and the driver. Nothing carried a booking into dispatch —
 * `BookingApproved` had one listener and it sent an email. The automatic
 * machinery was running the whole time; it only ever *advanced* offers a
 * human had already started.
 *
 * What is asserted here is the seam, not the matcher. Who gets ranked first
 * is `DispatchRecommender`'s question and has its own tests; these ask
 * whether approval reaches it at all, and whether the three things that must
 * stop it do.
 */

/**
 * A driver on duty, reporting a position, with a van — the state the
 * recommender needs before it can rank anybody at all.
 *
 * On Shanitah, which is the operator a corporate booking lands on and the one
 * `VehicleFactory` uses. `offerWaveForBooking` scopes drivers *and* vehicles
 * to `$booking->operator_id`, so a driver on another fleet is invisible to it
 * and would fail every test in this file for a reason none of them is about.
 */
function offerableDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $vehicle = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);

    // `vehicle_id` is the roster, and without it the recommender ranks
    // nobody — `MainFleetDispatchTest` builds its drivers the same way. A
    // driver with no vehicle is a driver the matcher cannot put in one.
    $driver = Driver::factory()->create([
        'user_id' => $user->id,
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $vehicle->id,
        'status' => 'active',
    ]);

    reportPosition($driver->id, $vehicle->id);

    return [$user, $driver, $vehicle];
}

/**
 * A fresh position for a driver already on duty.
 *
 * Separate because `presence_ttl_seconds` is 180 and one test travels an hour
 * and a half forward: a fixture whose heartbeat was written before the jump is
 * stale on arrival, and the test would fail for staleness while appearing to
 * fail about scheduling.
 */
function reportPosition(int $driverId, int $vehicleId): void
{
    $store = app(DriverPresenceStore::class);
    $store->setDuty($driverId, true, $vehicleId);
    $store->heartbeat(new DriverPresence(
        driverId: $driverId,
        onDuty: true,
        vehicleId: $vehicleId,
        latitude: 0.3476,
        longitude: 32.5825,
        accuracyMetres: 10.0,
        recordedAt: Carbon::now(),
    ));
}

/**
 * Raises a booking the way the console does, and lets it auto-approve.
 *
 * Through the endpoint rather than through `BookingService`, for two reasons.
 * A guard is only as deployed as its call sites, and this is the call site —
 * the reported behaviour was "I create the booking, it is automatically
 * approved, and I still have to go to Dispatch". And `TenantScope` fails
 * closed: approving with no tenant bound finds no booking at all, so a
 * service-level test would be testing a path the console never takes.
 */
function approveBooking(array $payload = []): Booking
{
    app(SettingsService::class)->setGroup('booking', ['approval_required' => false]);

    $tenant = Tenant::factory()->create();
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $response = test()->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/bookings', [
            'passenger_user_id' => $employee->id,
            'passenger_name' => 'Nakato Grace',
            'passenger_phone' => '0700123456',
            'origin' => 'Acacia Mall',
            'destination' => 'Entebbe Airport',
            ...$payload,
        ])
        ->assertStatus(201)
        // The premise of every test below: it really did approve itself.
        ->assertJsonPath('data.status', BookingStatus::APPROVED->value);

    return Booking::allTenants()->findOrFail($response->json('data.id'));
}

it('offers an approved booking to a driver without anybody assigning it', function () {
    Notification::fake();

    [$driverUser, $driver] = offerableDriver();

    $booking = approveBooking();

    /*
     * The whole report, in three assertions: an offer exists, it names this
     * booking, and a phone rang — with nobody having opened the dispatch
     * board.
     *
     * Mutation check: remove the `Event::listen` line in `AppServiceProvider`
     * and all three fail.
     */
    $offer = DispatchOffer::sole();

    expect($offer->booking_id)->toBe($booking->id)
        ->and($offer->driver_id)->toBe($driver->id)
        // Both halves the desk was doing by hand. The vehicle rides on the
        // offer, so an accept can write the trip on its own.
        ->and($offer->vehicle_id)->not->toBeNull();

    Notification::assertSentTo($driverUser, TripOfferedNotification::class);

    // Still nobody's trip. An offer is a question, and the booking stays the
    // desk's to reassign until somebody answers it.
    expect(Trip::count())->toBe(0);
});

it('leaves a booking scheduled for later alone', function () {
    /*
     * The walk-in path's rule, and the reason is the same: deciding how early
     * to start looking for tomorrow's 06:00 airport run is a scheduler's job,
     * deferred by name in ADR-0024. Offering it on approval would hold an
     * offer open overnight and burn every driver's rotation against a job
     * nobody can start.
     *
     * Mutation check: drop the `isFuture()` guard and this fails.
     */
    Notification::fake();
    [$driverUser] = offerableDriver();

    approveBooking(['scheduled_for' => Carbon::now()->addDays(2)]);

    expect(DispatchOffer::count())->toBe(0);

    // Narrow, not `assertNothingSent`: approving a booking always tells the
    // person who raised it, and that notice is not this feature's doing.
    // Asserting silence outright would fail on somebody else's message.
    Notification::assertNotSentTo($driverUser, TripOfferedNotification::class);
});

it('offers a booking whose slot arrived while it waited for approval', function () {
    /*
     * The other side of that guard, and the reason it asks `isFuture()`
     * rather than "does it have a scheduled time".
     *
     * This state cannot be created directly — the endpoint rejects a
     * `scheduled_for` in the past — so it is reached the only way it happens
     * in production: a booking raised for 14:00 sits waiting for a human to
     * approve it, and the approval lands at 14:20. By then the job is wanted
     * **now**, and sending it to the board alongside next Tuesday's would be
     * exactly the silent wait that was reported.
     *
     * Mutation check: swap `isFuture()` for `isImmediate()` — a null test —
     * and this fails while the scheduled-for-later test above still passes.
     */
    [, $driver, $vehicle] = offerableDriver();

    // Approval left switched on, so creation leaves it pending.
    $tenant = Tenant::factory()->create();
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);
    $approver = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $id = test()->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/bookings', [
            'passenger_user_id' => $employee->id,
            'passenger_name' => 'Nakato Grace',
            'passenger_phone' => '0700123456',
            'origin' => 'Acacia Mall',
            'destination' => 'Entebbe Airport',
            'scheduled_for' => Carbon::now()->addHour()->toIso8601String(),
        ])
        ->assertStatus(201)
        ->assertJsonPath('data.status', BookingStatus::PENDING->value)
        ->json('data.id');

    expect(DispatchOffer::count())->toBe(0);

    // The slot arrives, and only then does somebody approve it.
    test()->travel(90)->minutes();

    // The driver is still driving, and says so. Without this their last
    // position is ninety minutes old against a three-minute TTL and the
    // matcher would rightly refuse to rank them.
    reportPosition($driver->id, $vehicle->id);

    test()->actingAs($approver, 'sanctum')
        ->postJson("/api/v1/bookings/{$id}/approval")
        ->assertSuccessful();

    expect(DispatchOffer::count())->toBe(1);
});

it('does nothing when the setting is off', function () {
    /*
     * The kill switch has to be real, because this is the one feature on the
     * platform that makes a stranger's phone ring without a person deciding
     * it should. If it misbehaves in production the desk needs it stopped
     * without waiting for a deploy.
     *
     * Mutation check: remove the config gate and this fails.
     */
    config()->set('dispatch.booking_auto_offer', false);

    Notification::fake();
    [$driverUser] = offerableDriver();

    approveBooking();

    expect(DispatchOffer::count())->toBe(0);
    Notification::assertNotSentTo($driverUser, TripOfferedNotification::class);
});

it('still approves the booking when dispatch cannot find anybody', function () {
    /*
     * No driver on duty at all — the live situation on the day this was
     * written, where two drivers were flagged on duty with positions two days
     * stale and `dispatchable()` returned nothing.
     *
     * The approval must survive it. This listener runs after the approving
     * transaction has committed, so a throw here would answer the approver
     * with a failure for a decision that already happened and leave them
     * re-approving an approved booking. It degrades to exactly the behaviour
     * of the day before this shipped: a booking on the board, and a
     * dispatcher who assigns it.
     */
    $booking = approveBooking();

    expect($booking->status)->toBe(BookingStatus::APPROVED)
        ->and(DispatchOffer::count())->toBe(0);
});

it('never offers an unclaimed booking to another fleet', function () {
    /*
     * The case that would make widening the unclaimed scope a leak rather
     * than a fix.
     *
     * An unclaimed booking narrows to no operator, so the only thing standing
     * between this client's job and every fleet on the platform is
     * `offerableForFleet`'s commercial filter — contracted to this client, or
     * a main fleet. A rival's van is neither: free, nearby, perfectly capable
     * and not theirs to be given. `MainFleetDispatchTest` guards the same
     * sentence from the desk's side; this guards it from the scheduler's,
     * which is the side that acts with nobody watching.
     *
     * Mutation check: drop the `contracted || mainFleet` filter and this
     * fails while every other test in the file still passes.
     */
    Notification::fake();

    $rival = Operator::create([
        'name' => 'Rival Transporters',
        'slug' => 'rival-unclaimed-booking-test',
        'status' => 'active',
        'is_main_fleet' => false,
    ]);

    $rivalUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $rivalVehicle = Vehicle::factory()->create([
        'operator_id' => $rival->id,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);
    $rivalDriver = Driver::factory()->create([
        'user_id' => $rivalUser->id,
        'operator_id' => $rival->id,
        'vehicle_id' => $rivalVehicle->id,
        'status' => 'active',
    ]);

    reportPosition($rivalDriver->id, $rivalVehicle->id);

    approveBooking();

    expect(DispatchOffer::count())->toBe(0);
    Notification::assertNotSentTo($rivalUser, TripOfferedNotification::class);
});
