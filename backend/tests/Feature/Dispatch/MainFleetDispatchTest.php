<?php

use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchRecommender;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Vehicles\Models\Vehicle;

/**
 * The house fleet takes corporate work it holds no contract for.
 *
 * The owner, 29 August 2026: *"shanitah is the main fleet that has got all the
 * access to both walking and Coporate, the other just need to request another
 * contract."*
 *
 * ## What this does not change
 *
 * ADR-0009 §1 stands: a contracted vehicle still outranks a house one by the
 * full 1000 points, so a client paying to have vehicles set aside is still
 * served from them first. What changes is what happens when they are all out —
 * previously the booking went back to a desk that would have picked the house's
 * vehicle by hand, because there was nothing else to pick.
 *
 * ## And what it must not change
 *
 * A fleet that arrived to serve one client must still contract for the work.
 * The last case here is the one that would make this feature a leak: another
 * operator's free, nearby, perfectly capable vehicle must stay unofferable.
 */
function mainFleetActor(): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::SUPER_ADMIN,
    ]);
}

function bookingForClient(Tenant $tenant): Booking
{
    return Booking::factory()->create([
        'tenant_id' => $tenant->id,
        'passenger_count' => 1,
        'scheduled_for' => null,
    ]);
}

it('offers the house fleet a client it has no contract with', function () {
    $tenant = Tenant::factory()->create();

    $vehicle = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);

    Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $vehicle->id,
        'status' => 'active',
    ]);

    $offerable = app(DispatchRecommender::class)
        ->offerableFor(bookingForClient($tenant), mainFleetActor());

    // No allocation was written. Before the main-fleet flag this returned
    // nothing and the booking went to the desk with "no vehicle and driver are
    // both free" — which was true only in the sense that none was contracted.
    expect($offerable->pluck('vehicle.id')->all())->toContain($vehicle->id);
});

it('keeps a contracted vehicle ahead of the house fleet', function () {
    $tenant = Tenant::factory()->create();

    $house = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);
    Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $house->id,
        'status' => 'active',
    ]);

    $contracted = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);
    Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $contracted->id,
        'status' => 'active',
    ]);

    $booking = bookingForClient($tenant);

    VehicleAllocation::factory()->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $contracted->id,
        'starts_on' => now()->subDay(),
        'ends_on' => now()->addDay(),
    ]);

    $offerable = app(DispatchRecommender::class)->offerableFor($booking, mainFleetActor());

    // ADR-0009 §1. The house becoming eligible must not cost a paying client
    // the vehicles it set aside — eligibility widened, the ranking did not
    // move, and the 1000-point contract term is what keeps this first.
    expect($offerable->first()->vehicle->id)->toBe($contracted->id);
});

it('still refuses a fleet that is not the house and holds no contract', function () {
    $tenant = Tenant::factory()->create();

    $rival = Operator::create([
        'name' => 'Second Fleet Ltd',
        'slug' => 'second-fleet',
        'status' => 'active',
        'plan_id' => Plan::default()?->id,
    ]);

    $vehicle = Vehicle::factory()->create([
        'operator_id' => $rival->id,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);
    Driver::factory()->create([
        'operator_id' => $rival->id,
        'vehicle_id' => $vehicle->id,
        'status' => 'active',
    ]);

    $actor = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $rival->id,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $offerable = app(DispatchRecommender::class)
        ->offerableFor(bookingForClient($tenant), $actor);

    // The whole rule in one assertion. A fleet that joined to serve a
    // particular client requests a contract; being free and capable is not
    // standing to take somebody else's client's work.
    expect($offerable)->toBeEmpty();
});
