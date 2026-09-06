<?php

use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchRecommender;
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

    // **Contracted, because automatic dispatch now only commits a vehicle
    // the client has set aside** (owner's ruling, 2026-08-28). Without this
    // the endpoint correctly finds nothing and answers 409.
    VehicleAllocation::factory()->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'starts_on' => now()->subDay(),
        'ends_on' => now()->addDay(),
    ]);

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
    $vehicle = Vehicle::factory()->create(['seating_capacity' => 5]);
    $booking = bookingAt($tenant);
    $booking->update(['status' => 'assigned']);

    // Contracted, so the endpoint gets past "nothing can take this" and
    // refuses for the reason this test is actually about. The candidate
    // search runs before the transition guard, so without it the 409 would
    // be the right status for the wrong reason.
    VehicleAllocation::factory()->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'starts_on' => now()->subDay(),
        'ends_on' => now()->addDay(),
    ]);

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

/*
  **Offering is not ranking, and the difference is a commercial agreement.**

  `forBooking` is the dispatcher's own board: everything that could take the
  job, contracted vehicles on top, because a human choosing by hand should see
  the whole picture. `offerableFor` is what goes out to drivers with nobody
  watching, and it filters rather than sorts.

  **The filter widened on 2026-08-29 and the ranking did not.** The owner:
  *"shanitah is the main fleet that has got all the access to both walking and
  Coporate, the other just need to request another contract."* The house fleet
  is the platform's own operation and needs no contract with a client it
  already serves; every other fleet contracts for the work, which is asserted
  in `MainFleetDispatchTest` because a fleet dispatcher cannot see a rival
  fleet's vehicles at all (`BelongsToOperator::scopeForActor`) and the case
  cannot be written from this file's actor.

  What did not move is the thing worth protecting: a contracted vehicle still
  outranks everything by 1000 points, so a client paying to have vehicles set
  aside is still served from them first.
*/

it('offers the contracted vehicle first even when a nearer one could take it', function () {
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();
    Driver::factory()->create();

    $booking = bookingAt($tenant, 0.3476, 32.5825);

    $nearer = Vehicle::factory()->create(['registration_number' => 'UDD 444D', 'seating_capacity' => 5]);
    $contracted = Vehicle::factory()->create(['registration_number' => 'UCC 333C', 'seating_capacity' => 5]);

    // The uncontracted one is next door and the contracted one is across
    // town, so distance argues the wrong way and only the ruling can decide.
    parkVehicleAt($nearer, $tenant, 0.3480, 32.5830);
    parkVehicleAt($contracted, $tenant, 0.4500, 32.7000);

    VehicleAllocation::factory()->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $contracted->id,
        'starts_on' => now()->subDay(),
        'ends_on' => now()->addDay(),
    ]);

    $recommender = app(DispatchRecommender::class);
    $actor = autoDispatcher();

    // The board still shows both, contracted first — that half is unchanged.
    expect($recommender->forBooking($booking, $actor))->toHaveCount(2);

    $offerable = $recommender->offerableFor($booking, $actor);

    /*
      Both are offerable now — they are the house fleet's — and the assertion
      that matters is the **order**. Distance argues the wrong way here by
      construction, so anything but the contracted vehicle first would mean a
      heuristic had overridden a commercial agreement.
    */
    expect($offerable->first()->vehicle->registration_number)->toBe('UCC 333C');
    expect($offerable->first()->contracted)->toBeTrue();
});

it("offers the house fleet's own vehicle when the client contracted nothing", function () {
    /*
      The 2026-08-29 change, at the point where it pays for itself. This
      returned nothing until then, and the booking went back to a desk that
      would have assigned this very vehicle by hand — the refusal cost a
      dispatcher's attention and bought the client nothing, because there was
      no contract for it to protect.
    */
    $tenant = Tenant::factory()->create();
    Driver::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);

    $booking = bookingAt($tenant, 0.3476, 32.5825);
    $recommender = app(DispatchRecommender::class);

    $offerable = $recommender->offerableFor($booking, autoDispatcher());

    expect($offerable)->not->toBeEmpty();
    // Offered as the house, not as a contract that was never written.
    expect($offerable->first()->contracted)->toBeFalse();
    expect($offerable->first()->mainFleet)->toBeTrue();
});

it('sends a booking back to the desk when nothing at all can take it', function () {
    /*
      The refusal path, at the point where it costs something. A vehicle is
      free, near and big enough — and there is nobody to drive it, so
      automatic dispatch refuses rather than committing a trip to an empty
      seat. The job returns to the queue a dispatcher is already watching,
      which is where an unanswerable one belonged before automatic dispatch
      existed.

      No driver rather than no contract: since 2026-08-29 the house fleet
      needs none, so a missing contract is no longer what strands a Shanitah
      booking. `MainFleetDispatchTest` holds the case that still is — another
      fleet, free and capable, refused for want of one.
    */
    config()->set('dispatch.automatic_enabled', true);

    $tenant = Tenant::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);
    $booking = bookingAt($tenant);

    $this->actingAs(autoDispatcher(), 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/auto-assignment")
        ->assertStatus(409)
        ->assertJsonPath('code', 'NO_DISPATCH_CANDIDATE')
        // The message names *which* of the refusals this is. One sentence
        // covering "nothing is free", "nothing is contracted" and "the seats
        // are too few" sent the owner hunting a permissions problem on
        // 29 August, and the three have different fixes.
        ->assertJsonPath('message', fn (string $m) => str_contains($m, 'no vehicle and driver are both free'));

    // Still the desk's to place, and still in the queue.
    expect($booking->fresh()->status->value)->not->toBe('assigned');
});

it('names a missing contract as a contract, not as a shortage', function () {
    /*
      The other refusal, and the reason they had to be told apart. A fleet
      that is not the house has vehicles free and no contract with this
      client: nothing is scarce, a form is missing, and the sentence says so
      with the fix in it. Told as "no vehicle is free" it reads as a busy
      morning and a desk waits for one to come back.
    */
    config()->set('dispatch.automatic_enabled', true);

    $rival = Operator::create([
        'name' => 'Second Fleet Ltd',
        'slug' => 'second-fleet-refusal',
        'status' => 'active',
        'plan_id' => Plan::default()?->id,
    ]);

    $tenant = Tenant::factory()->create();
    $vehicle = Vehicle::factory()->create(['operator_id' => $rival->id, 'seating_capacity' => 5]);
    Driver::factory()->create(['operator_id' => $rival->id, 'vehicle_id' => $vehicle->id]);

    $dispatcher = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $rival->id,
        'role' => UserRole::DISPATCHER,
    ]);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson('/api/v1/bookings/'.bookingAt($tenant)->id.'/auto-assignment')
        ->assertStatus(409)
        ->assertJsonPath('code', 'NO_DISPATCH_CANDIDATE')
        ->assertJsonPath('message', fn (string $m) => str_contains($m, 'none is contracted to this client'));
});
