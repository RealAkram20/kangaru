<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Notifications\TripExtensionRequestedNotification;
use Modules\Trips\Distance\CleanedTrace;
use Modules\Trips\Distance\MatchedChunk;
use Modules\Trips\Distance\MeasuredTrace;
use Modules\Trips\Distance\MeasurementRouter;
use Modules\Trips\Distance\RouteReference;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Enums\TripStopKind;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Enums\TripStopStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripStop;
use Modules\Vehicles\Models\Vehicle;

/**
 * The passenger who travels past the drop-off they agreed to.
 *
 * Three things are worth protecting here, and they fail in three different
 * ways:
 *
 * 1. **The reference route runs through the extension.** This is the money.
 *    `DistanceResolver::ROUTE_CAPPED` holds the billed figure at the
 *    reference plus a detour allowance, so a reference drawn between the
 *    original two pins would read a correct trace as implausible, cap the
 *    distance at the journey the passenger did *not* take, and leave the
 *    extra kilometres unpaid — silently, and with a variance for the office
 *    to investigate.
 * 2. **Consent.** A passenger proposes; the driver answers. Nothing routes
 *    through or bills an extension nobody agreed to.
 * 3. **The boundary.** An extension is not the destination until the agreed
 *    drop-off has been reached, or the driver's own map sends them past the
 *    place they were hired to reach.
 */

/** Records the waypoints it was asked to route, and answers 10 km a leg. */
class RecordingRouter implements MeasurementRouter
{
    /** @var array<int, array<int, array{0: float, 1: float}>> */
    public array $routeCalls = [];

    public function available(): bool
    {
        return true;
    }

    public function name(): string
    {
        return 'recording';
    }

    public function match(array $points): ?MatchedChunk
    {
        return null;
    }

    public function routeKilometres(array $waypoints): ?float
    {
        $this->routeCalls[] = $waypoints;

        // A figure that grows with the number of legs, so a test can tell a
        // two-pin route from one that visited an extension without knowing
        // anything about real geography.
        return 10.0 * (count($waypoints) - 1);
    }
}

function emptyMeasuredTrace(): MeasuredTrace
{
    return new MeasuredTrace(
        cleaned: new CleanedTrace(points: [], presence: [], total: 0, dropped: []),
        gpsKm: null,
        matchedKm: 0.0,
        inferredKm: 0.0,
        haversineKm: 0.0,
        coveragePercent: null,
        inferredSharePercent: null,
        gapsRouted: 0,
        provider: 'recording',
        polylines: [],
    );
}

function seedExtensionFixture(TripStatus $status = TripStatus::TRIP_STARTED): array
{
    $tenant = Tenant::factory()->create();
    $vehicle = Vehicle::factory()->create();

    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle($vehicle)
        ->forDriver($driver)
        ->create(['status' => $status, 'destination' => 'Mukono Town']);

    return compact('tenant', 'vehicle', 'driverUser', 'driver', 'trip');
}

/** Appends an extension straight to the table, past the service. */
function makeExtension(Trip $trip, TripStopStatus $status, float $lat = 0.35, float $lng = 32.75): TripStop
{
    return TripStop::query()->create([
        'tenant_id' => $trip->tenant_id,
        'trip_id' => $trip->id,
        'sequence' => ((int) TripStop::query()->forTrip($trip)->max('sequence')) + 1,
        'label' => 'On to Kampala Road',
        'latitude' => $lat,
        'longitude' => $lng,
        'kind' => TripStopKind::EXTENSION,
        'source' => TripStopSource::ADDED_BY_CLIENT,
        'status' => $status,
        'accepted_at' => $status === TripStopStatus::PENDING ? now() : null,
    ]);
}

it('draws the reference route through an accepted extension, so the extra distance can be billed', function () {
    ['trip' => $trip] = seedExtensionFixture();

    OrderRequest::factory()->create([
        'trip_id' => $trip->id,
        'pickup_latitude' => 0.3950, 'pickup_longitude' => 32.7023,
        'dropoff_latitude' => 0.3533, 'dropoff_longitude' => 32.7553,
    ]);

    makeExtension($trip->refresh(), TripStopStatus::PENDING);

    $router = new RecordingRouter;
    $reference = (new RouteReference($router))->for($trip->refresh(), emptyMeasuredTrace());

    // Three waypoints — pickup, the agreed drop-off, then the extension —
    // rather than the two the trip was booked with.
    expect($router->routeCalls)->toHaveCount(1);
    expect($router->routeCalls[0])->toHaveCount(3);
    expect($router->routeCalls[0][2])->toBe([0.35, 32.75]);

    // And the reference is the longer journey. Were it 10.0 here, the
    // resolver would cap a correct trace at the ride the passenger did not
    // take.
    expect($reference)->toBe(['km' => 20.0, 'source' => RouteReference::FROM_PINS]);
});

it('leaves a proposed extension out of the reference route, because nobody agreed to it', function () {
    ['trip' => $trip] = seedExtensionFixture();

    OrderRequest::factory()->create([
        'trip_id' => $trip->id,
        'pickup_latitude' => 0.3950, 'pickup_longitude' => 32.7023,
        'dropoff_latitude' => 0.3533, 'dropoff_longitude' => 32.7553,
    ]);

    makeExtension($trip->refresh(), TripStopStatus::PROPOSED);
    // A declined one is equally not part of the journey.
    makeExtension($trip->refresh(), TripStopStatus::SKIPPED, 0.36, 32.76);

    $router = new RecordingRouter;
    $reference = (new RouteReference($router))->for($trip->refresh(), emptyMeasuredTrace());

    expect($router->routeCalls[0])->toHaveCount(2);
    expect($reference['km'])->toBe(10.0);
});

it('leaves a label-only extension out of the route rather than guessing a pin for it', function () {
    ['trip' => $trip] = seedExtensionFixture();

    OrderRequest::factory()->create([
        'trip_id' => $trip->id,
        'pickup_latitude' => 0.3950, 'pickup_longitude' => 32.7023,
        'dropoff_latitude' => 0.3533, 'dropoff_longitude' => 32.7553,
    ]);

    $stop = makeExtension($trip->refresh(), TripStopStatus::PENDING);
    $stop->forceFill(['latitude' => null, 'longitude' => null])->save();

    $router = new RecordingRouter;
    (new RouteReference($router))->for($trip->refresh(), emptyMeasuredTrace());

    // The weaker honest answer, not a stronger invented one. The trip is
    // still billed on its trace; it simply has no pin to steer the bound.
    expect($router->routeCalls[0])->toHaveCount(2);
});

it('lets the driver extend a running trip, accepted on the spot and not counted unplanned', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedExtensionFixture();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions", ['label' => 'On to Kampala Road'])
        ->assertStatus(201)
        ->assertJsonPath('data.kind', 'extension')
        ->assertJsonPath('data.source', 'added_by_driver')
        ->assertJsonPath('data.status', 'pending');

    // §4's counter means "deviated from the plan and nobody billed for it".
    // An extension is billed, so it must not appear there.
    expect($trip->refresh()->unplanned_stop_count)->toBe(0);
});

it('lands a passenger request as proposed, and bills nothing until the driver takes it', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    $customer = Customer::factory()->create();
    OrderRequest::factory()->create(['customer_id' => $customer->id, 'trip_id' => $trip->id]);
    $trip->forceFill(['customer_id' => $customer->id])->save();

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/extension', [
            'label' => 'On to Kampala Road',
            'latitude' => 0.35,
            'longitude' => 32.75,
        ])
        ->assertStatus(201)
        ->assertJsonPath('data.kind', 'extension')
        ->assertJsonPath('data.source', 'added_by_client')
        ->assertJsonPath('data.status', 'proposed')
        ->assertJsonPath('data.accepted_at', null);

    $extension = TripStop::query()->forTrip($trip)->first();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions/{$extension->id}/acceptance")
        ->assertOk()
        ->assertJsonPath('data.status', 'pending');

    expect($extension->refresh()->accepted_at)->not->toBeNull();
});

it('answers a request only once, so two taps on Accept do not agree twice', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    $extension = makeExtension($trip, TripStopStatus::PROPOSED);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions/{$extension->id}/acceptance")
        ->assertOk();

    // Masked 404 rather than a second success: the row is no longer an
    // unanswered extension, and the caller is not told which of the several
    // reasons applies.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions/{$extension->id}/decline")
        ->assertNotFound();

    expect($extension->refresh()->status)->toBe(TripStopStatus::PENDING);
});

it('records a decline with its reason instead of deleting the request', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    $extension = makeExtension($trip, TripStopStatus::PROPOSED);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions/{$extension->id}/decline", [
            'reason' => 'My shift ends in ten minutes.',
        ])
        ->assertOk()
        ->assertJsonPath('data.status', 'skipped')
        ->assertJsonPath('data.skip_reason', 'My shift ends in ten minutes.');
});

it('refuses to complete a trip with an agreed extension still to run', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    makeExtension($trip, TripStopStatus::PENDING);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => 'trip_completed',
            'odometer_end' => 12_600,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('to');
});

it('lets a trip complete over an extension nobody answered', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    // A back-seat tap must not be able to hold a driver's shift open.
    makeExtension($trip, TripStopStatus::PROPOSED);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", [
            'to' => 'trip_completed',
            'odometer_end' => 12_600,
        ])
        ->assertOk();
});

it('keeps the driver pointed at the agreed drop-off until it is marked reached', function () {
    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    makeExtension($trip, TripStopStatus::PENDING);

    expect($trip->refresh()->dropoff_reached_at)->toBeNull();

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/dropoff-arrival")
        ->assertOk()
        ->assertJsonPath('data.dropoff_reached_at', fn ($at) => $at !== null);

    $reached = $trip->refresh()->dropoff_reached_at;

    // Idempotent: a second tap, or a retry into a dead zone, must not move
    // the boundary an extension was added on either side of.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/dropoff-arrival")
        ->assertOk();

    expect($trip->refresh()->dropoff_reached_at->toIso8601String())
        ->toBe($reached->toIso8601String());
});

it('refuses to extend a trip that is not running', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = seedExtensionFixture(TripStatus::TRIP_COMPLETED);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions", ['label' => 'Too late'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_NOT_ACTIVE');
});

it('refuses a driver who is not on the trip', function () {
    ['trip' => $trip] = seedExtensionFixture();

    $stranger = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $stranger->id]);

    $this->actingAs($stranger, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/extensions", ['label' => 'Not mine'])
        ->assertForbidden();
});

it('tells the driver their passenger asked, without dressing it as a job offer', function () {
    Notification::fake();

    ['trip' => $trip, 'driverUser' => $driverUser] = seedExtensionFixture();

    $customer = Customer::factory()->create();
    OrderRequest::factory()->create(['customer_id' => $customer->id, 'trip_id' => $trip->id]);
    $trip->forceFill(['customer_id' => $customer->id])->save();

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/extension', ['label' => 'On to Kampala Road'])
        ->assertStatus(201);

    Notification::assertSentTo(
        $driverUser,
        TripExtensionRequestedNotification::class,
        function (TripExtensionRequestedNotification $notification) {
            $context = $notification->context();

            // **`extension_id`, never `offer_id`.** The app reads `offer_id`
            // to mean "raise the incoming-call screen for a job", so a
            // payload that borrowed the key would put a full-screen call in
            // front of a driver for a question their passenger just asked
            // out loud.
            expect($context)->toHaveKey('extension_id');
            expect($context)->not->toHaveKey('offer_id');

            // No ringtone and no call channel: that sound means "a job is
            // leaving in forty-five seconds", and nothing here expires.
            expect($notification->pushOptions())->not->toHaveKey('sound');
            expect($notification->pushOptions())->not->toHaveKey('channelId');

            return true;
        },
    );
});
