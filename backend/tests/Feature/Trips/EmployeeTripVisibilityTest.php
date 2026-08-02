<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\BookingService;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * A Corporate Employee sees the trips their own bookings produced, and no
 * others.
 *
 * This existed as a gap, not a regression: until TripPolicy and
 * TripController learned about the role, an employee could list every trip
 * in the tenant — origin, destination, driver, vehicle and timings for
 * every colleague — while being correctly barred from the bookings behind
 * them. It was found by logging in as `staff@centenary-bank.test` and
 * reading the response, not by review.
 *
 * The trips here are produced by dispatching real bookings through
 * DispatchService, because the link the policy relies on is
 * `trip.booking.requested_by_user_id`. A Trip factory row with a
 * hand-set `booking_id` would test the query and not the pathway.
 */

/**
 * Two employees, each with a booking of their own dispatched to a trip.
 *
 * @return array<string, mixed>
 */
function employeeTripFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $approver = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $mine = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    $theirs = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $raise = function (User $requester, string $destination) use ($tenant, $approver, $dispatcher): Trip {
        $booking = app(BookingService::class)->create([
            'tenant_id' => $tenant->id,
            'passenger_name' => $requester->name,
            'passenger_phone' => '+256700000000',
            'passenger_count' => 1,
            'origin' => 'Kampala',
            'destination' => $destination,
        ], $requester);

        app(BookingService::class)->approve($booking, $approver);

        // A vehicle and driver per trip: dispatch takes a pessimistic lock
        // and refuses to commit either to two live trips at once.
        return app(DispatchService::class)->assign(
            $booking->refresh(),
            Vehicle::factory()->create()->id,
            Driver::factory()->create()->id,
            $dispatcher,
        );
    };

    $myTrip = $raise($mine, 'Entebbe');
    $theirTrip = $raise($theirs, 'Jinja');

    return compact('tenant', 'dispatcher', 'approver', 'mine', 'theirs', 'myTrip', 'theirTrip');
}

it('lists only the trips an employee\'s own bookings produced', function () {
    ['mine' => $mine, 'myTrip' => $myTrip, 'theirTrip' => $theirTrip] = employeeTripFixture();

    $response = $this->actingAs($mine, 'sanctum')->getJson('/api/v1/trips')->assertOk();

    $ids = array_column($response->json('data'), 'id');

    expect($ids)->toContain($myTrip->id);
    // The colleague's trip is the whole point. Before this narrowing it was
    // in this list, complete with where they went and when.
    expect($ids)->not->toContain($theirTrip->id);
    expect($ids)->toHaveCount(1);
});

it('refuses an employee a colleague\'s trip', function () {
    ['mine' => $mine, 'theirTrip' => $theirTrip] = employeeTripFixture();

    // 403, matching how every other intra-tenant refusal in this module
    // answers — a Driver reaching for another driver's trip gets the same.
    // AGENTS.md's "404, never 403" rule is about *cross-tenant* ids, and
    // this is one tenant's own staff.
    //
    // Worth noting rather than acting on unilaterally: a 403 does confirm
    // the trip exists, so a determined employee could learn that some
    // colleague travelled, if not who or where. Moving intra-tenant
    // refusals to 404 would close that, but it is a platform-wide API
    // decision and a breaking change for existing clients, not something
    // to slip into this pass.
    $this->actingAs($mine, 'sanctum')
        ->getJson("/api/v1/trips/{$theirTrip->id}")
        ->assertForbidden();
});

it('still lets an employee open their own trip', function () {
    ['mine' => $mine, 'myTrip' => $myTrip] = employeeTripFixture();

    $this->actingAs($mine, 'sanctum')
        ->getJson("/api/v1/trips/{$myTrip->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $myTrip->id);
});

it('hides a trip that has no booking behind it', function () {
    ['tenant' => $tenant, 'mine' => $mine] = employeeTripFixture();

    // POST /api/v1/trips raises a trip with no booking. Nothing connects it
    // to an employee, so nothing should show it to one — the `?->` in the
    // policy yields null, which never equals a user id.
    $orphan = Trip::factory()->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create(['booking_id' => null, 'origin' => 'Kampala', 'destination' => 'Gulu']);

    $response = $this->actingAs($mine, 'sanctum')->getJson('/api/v1/trips')->assertOk();

    expect(array_column($response->json('data'), 'id'))->not->toContain($orphan->id);
});

it('leaves the desk roles seeing everything', function () {
    ['dispatcher' => $dispatcher, 'myTrip' => $myTrip, 'theirTrip' => $theirTrip] = employeeTripFixture();

    // The narrowing is about the employee, not about trips becoming
    // private. A dispatcher runs the fleet and must see all of it.
    $ids = array_column(
        $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/trips')->assertOk()->json('data'),
        'id',
    );

    expect($ids)->toContain($myTrip->id);
    expect($ids)->toContain($theirTrip->id);
});

it('keeps a booking and the trip it produced consistently visible', function () {
    ['mine' => $mine, 'theirTrip' => $theirTrip] = employeeTripFixture();

    // The invariant behind the fix: an employee could already not read a
    // colleague's booking. A trip is that booking carried out, so if one is
    // hidden the other must be. They disagreed until now.
    $bookings = array_column(
        $this->actingAs($mine, 'sanctum')->getJson('/api/v1/bookings')->assertOk()->json('data'),
        'id',
    );

    expect($bookings)->not->toContain($theirTrip->booking_id);
    expect(Booking::query()->count())->toBe(2);
});
