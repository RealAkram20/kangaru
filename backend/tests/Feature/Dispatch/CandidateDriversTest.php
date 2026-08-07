<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Models\DriverShiftWindow;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0017 on the dispatch board's driver picker.
 *
 * The vehicle half of this shipped with ADR-0009; the driver half did not
 * exist, so a dispatcher was offered every active driver with nothing to say
 * which of them was on leave or rostered off. The rule was enforced at the
 * assignment endpoint, which meant it was discovered by being stopped rather
 * than by looking — a rule the product kept to itself.
 */
function candidateDispatcher(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
}

function candidateDriverRows(User $actor, Booking $booking): array
{
    return test()->actingAs($actor, 'sanctum')
        ->getJson("/api/v1/bookings/{$booking->id}/candidate-drivers")
        ->assertOk()
        ->json('data');
}

function bookingForCandidates(): Booking
{
    return Booking::factory()->forTenant(Tenant::factory()->create())->create(['scheduled_for' => null]);
}

it('lists an unavailable driver rather than hiding them, with a reason', function () {
    $booking = bookingForCandidates();
    $free = Driver::factory()->create(['name' => 'Aaa Free']);
    $onLeave = Driver::factory()->create(['name' => 'Bbb OnLeave']);

    AvailabilityBlock::factory()->forDriver($onLeave)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $rows = collect(candidateDriverRows(candidateDispatcher(), $booking))->keyBy('id');

    // Listed, not filtered out — a dispatcher who knows the roster will ask
    // where somebody went, and silence is the worst available answer.
    expect($rows->has($onLeave->id))->toBeTrue();
    expect($rows[$onLeave->id]['dispatchable'])->toBeFalse();
    expect($rows[$onLeave->id]['note'])->toBe('Not available for this time.');
    expect($rows[$free->id]['dispatchable'])->toBeTrue();
    expect($rows[$free->id]['note'])->toBeNull();
});

it('does not say which kind of absence it is', function () {
    $booking = bookingForCandidates();
    $driver = Driver::factory()->create();

    AvailabilityBlock::factory()->forDriver($driver)->create([
        'kind' => AvailabilityKind::SICK,
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $rows = collect(candidateDriverRows(candidateDispatcher(), $booking))->keyBy('id');

    // A board is shared across a depot; a colleague's health is not a
    // dispatch input. The kind stays queryable on the block itself.
    expect($rows[$driver->id]['note'])->not->toContain('sick');
});

it('separates off-shift from otherwise unavailable, which are different fixes', function () {
    $booking = bookingForCandidates();
    $driver = Driver::factory()->create();

    // A roster covering every weekday except today, so every window misses.
    foreach (range(0, 6) as $weekday) {
        if ($weekday === now()->dayOfWeek) {
            continue;
        }

        DriverShiftWindow::create([
            'driver_id' => $driver->id,
            'weekday' => $weekday,
            'starts_at' => '06:00:00',
            'ends_at' => '18:00:00',
        ]);
    }

    $rows = collect(candidateDriverRows(candidateDispatcher(), $booking))->keyBy('id');

    // "Not rostered" is a different problem from "on leave": one is fixed by
    // changing the roster, the other by waiting.
    expect($rows[$driver->id]['dispatchable'])->toBeFalse();
    expect($rows[$driver->id]['note'])->toBe('Not rostered for this time.');
});

it('puts available drivers first', function () {
    $booking = bookingForCandidates();
    // Named so alphabetical order alone would put the blocked one first.
    $blocked = Driver::factory()->create(['name' => 'Aaa Blocked']);
    Driver::factory()->create(['name' => 'Zzz Free']);

    AvailabilityBlock::factory()->forDriver($blocked)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $rows = candidateDriverRows(candidateDispatcher(), $booking);

    expect($rows[0]['name'])->toBe('Zzz Free');
    expect($rows[count($rows) - 1]['name'])->toBe('Aaa Blocked');
});

it('is gated on the same ability as the assignment it precedes', function () {
    $tenant = Tenant::factory()->create();
    $booking = Booking::factory()->forTenant($tenant)->create();

    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $this->actingAs($employee, 'sanctum')
        ->getJson("/api/v1/bookings/{$booking->id}/candidate-drivers")
        ->assertForbidden();
});

it('agrees with the assignment endpoint, which is the whole point', function () {
    $booking = bookingForCandidates();
    $driver = Driver::factory()->create();
    $vehicle = Vehicle::factory()->create();

    AvailabilityBlock::factory()->forDriver($driver)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $dispatcher = candidateDispatcher();
    $rows = collect(candidateDriverRows($dispatcher, $booking))->keyBy('id');

    expect($rows[$driver->id]['dispatchable'])->toBeFalse();

    // A list that says no beside an endpoint that says yes would be worse
    // than no list at all.
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(409);
});
