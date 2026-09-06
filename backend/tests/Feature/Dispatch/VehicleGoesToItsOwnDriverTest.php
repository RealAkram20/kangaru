<?php

use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchRecommender;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * A vehicle is offered to the driver who already has it.
 *
 * The owner, 29 August 2026: *"these vehicle are already given to them way
 * before … by the time of order everything is smooth, we don't need to asing
 * vehicles as well."*
 *
 * ## The bug this closes
 *
 * `forBooking` paired by **position** — vehicle *i* with driver *i* — on the
 * reasoning that "the choice of driver barely depends on the choice of vehicle
 * once both are free". That is true of a depot handing out cars at the start of
 * a shift. It is false of every fleet where drivers keep their vehicles, and
 * there the pairing is a coin toss: the boda could be offered to a van driver
 * and the van to the boda rider, and `assign()` would commit it, because the
 * assignment endpoint only asks whether each is free.
 *
 * Nothing 409s and nothing looks wrong on the board. The driver finds out.
 *
 * ## What is deliberately kept
 *
 * Round-robin over the vehicles nobody holds. A depot car really has no driver
 * until it is handed over, and refusing to pair one would take a working
 * arrangement away to fix a different fleet's problem.
 */
function pairingActor(): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::SUPER_ADMIN,
    ]);
}

function pairingBooking(): Booking
{
    return Booking::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'passenger_count' => 1,
        'scheduled_for' => null,
    ]);
}

it('offers each vehicle to the driver holding it, never to another', function () {
    $boda = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'category' => 'boda',
        'status' => 'active',
        'seating_capacity' => 2,
    ]);
    $van = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'category' => 'van',
        'status' => 'active',
        'seating_capacity' => 14,
    ]);

    $rider = Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $boda->id,
        'status' => 'active',
    ]);
    $vanDriver = Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $van->id,
        'status' => 'active',
    ]);

    $pairs = app(DispatchRecommender::class)
        ->forBooking(pairingBooking(), pairingActor())
        ->mapWithKeys(fn ($s) => [$s->vehicle->id => $s->driver->id]);

    // Both, not one: pairing by position gets half of a two-vehicle fleet
    // right by luck, so asserting a single row would pass on a coin toss.
    expect($pairs[$boda->id])->toBe($rider->id);
    expect($pairs[$van->id])->toBe($vanDriver->id);
});

it('still hands a depot vehicle to a driver holding nothing', function () {
    $pool = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);

    $unassigned = Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => null,
        'status' => 'active',
    ]);

    $pairs = app(DispatchRecommender::class)
        ->forBooking(pairingBooking(), pairingActor())
        ->mapWithKeys(fn ($s) => [$s->vehicle->id => $s->driver->id]);

    // The arrangement the old pairing was written for, and it still works: a
    // car the depot allocates per shift has no driver until it is handed over.
    expect($pairs[$pool->id])->toBe($unassigned->id);
});

it('drops a vehicle nobody free can drive rather than pairing it with somebody else', function () {
    $held = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);
    $orphan = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);

    $only = Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $held->id,
        'status' => 'active',
    ]);

    $rows = app(DispatchRecommender::class)->forBooking(pairingBooking(), pairingActor());

    // The one driver on shift has their own vehicle. Offering them the second
    // one as well would be offering the same person twice — a board showing
    // two choices where there is one, and whichever is taken strands the
    // other.
    expect($rows->pluck('vehicle.id')->all())->toBe([$held->id]);
    expect($rows->first()->driver->id)->toBe($only->id);
});

it('frees a driver whose own vehicle is off the road to take a depot one', function () {
    $inWorkshop = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'maintenance',
        'seating_capacity' => 4,
    ]);
    $depot = Vehicle::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'status' => 'active',
        'seating_capacity' => 4,
    ]);

    $stranded = Driver::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'vehicle_id' => $inWorkshop->id,
        'status' => 'active',
    ]);

    $pairs = app(DispatchRecommender::class)
        ->forBooking(pairingBooking(), pairingActor())
        ->mapWithKeys(fn ($s) => [$s->vehicle->id => $s->driver->id]);

    /*
      Holding a vehicle nobody can be offered is holding nothing. Keying the
      pool on "has a vehicle_id" rather than "holds one of today's" put this
      driver in neither group — not paired, because their own vehicle was
      filtered out upstream, and not in the pool, because the column was set —
      so a rider whose boda was in for a service could drive nothing at all.
    */
    expect($pairs)->toHaveKey($depot->id);
    expect($pairs[$depot->id])->toBe($stranded->id);
    expect($pairs)->not->toHaveKey($inWorkshop->id);
});
