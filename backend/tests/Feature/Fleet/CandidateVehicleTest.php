<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

use function Pest\Laravel\actingAs;

/**
 * ADR-0009 §1, the half a dispatcher is meant to *see*.
 *
 * The rule was enforced before this endpoint existed, which meant the
 * ranking was discovered by being refused. These assert that the list says
 * the same thing the assignment does — and the last test asserts it for
 * every vehicle in the pool at once, because two implementations of one
 * rule drift silently and the symptom is a list that offers a vehicle
 * dispatch will not accept.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);

    $this->bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $this->ngo = Tenant::factory()->create(['name' => 'Acme NGO']);

    $this->dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
    $this->driver = Driver::factory()->create();

    $this->contracted = Vehicle::factory()->create(['registration_number' => 'UAA 001A']);
    $this->pool = Vehicle::factory()->create(['registration_number' => 'UAA 002B']);
    $this->blocked = Vehicle::factory()->create(['registration_number' => 'UAA 003C']);

    $this->booking = Booking::factory()->forTenant($this->bank)->create();
});

function candidatesFor(Booking $booking, User $as)
{
    return actingAs($as)->getJson("/api/v1/bookings/{$booking->id}/candidate-vehicles");
}

/** @return array<string, array<string, mixed>> keyed by registration */
function candidatesByRegistration(Booking $booking, User $as): array
{
    $rows = candidatesFor($booking, $as)->assertOk()->json('data');

    return collect($rows)->keyBy('registration_number')->all();
}

it('ranks a contracted vehicle above the rest of the pool', function () {
    VehicleAllocation::factory()
        ->forTenant($this->bank)->forVehicle($this->contracted)
        ->between(now()->subDay()->toDateString(), null)->create();

    $rows = candidatesFor($this->booking, $this->dispatcher)->assertOk()->json('data');

    // First, regardless of registration — 'UAA 001A' would sort first
    // alphabetically anyway, so the fixture deliberately checks the flag too.
    expect($rows[0]['registration_number'])->toBe('UAA 001A');
    expect($rows[0]['allocated'])->toBeTrue();
    expect($rows[0]['note'])->toBe('Contracted to this client for this date.');

    // And everything else is not contracted.
    expect(collect($rows)->skip(1)->pluck('allocated')->unique()->all())->toBe([false]);
});

it('ranks a contracted vehicle first even when it sorts last by registration', function () {
    $late = Vehicle::factory()->create(['registration_number' => 'UZZ 999Z']);

    VehicleAllocation::factory()
        ->forTenant($this->bank)->forVehicle($late)
        ->between(now()->subDay()->toDateString(), null)->create();

    $rows = candidatesFor($this->booking, $this->dispatcher)->assertOk()->json('data');

    expect($rows[0]['registration_number'])->toBe('UZZ 999Z');
});

/**
 * ADR-0009: exclusivity "needs a clear error rather than an empty vehicle
 * list". A dispatcher who knows the fleet will ask where the vehicle went,
 * and dropping it silently is the worst available answer.
 */
it('lists a vehicle contracted exclusively elsewhere, flagged rather than hidden', function () {
    VehicleAllocation::factory()
        ->forTenant($this->ngo)->forVehicle($this->blocked)
        ->between(now()->subDay()->toDateString(), null)->exclusive()->create();

    $rows = candidatesByRegistration($this->booking, $this->dispatcher);

    expect($rows)->toHaveKey('UAA 003C');
    expect($rows['UAA 003C']['dispatchable'])->toBeFalse();
    expect($rows['UAA 003C']['note'])->toBe('Contracted exclusively to another client for this date.');
});

it('never names the other client', function () {
    VehicleAllocation::factory()
        ->forTenant($this->ngo)->forVehicle($this->blocked)
        ->between(now()->subDay()->toDateString(), null)->exclusive()->create();

    $body = candidatesFor($this->booking, $this->dispatcher)->assertOk()->getContent();

    expect($body)->not->toContain('Acme NGO');
});

it('marks which vehicles will demand a reason, and which will not', function () {
    VehicleAllocation::factory()
        ->forTenant($this->bank)->forVehicle($this->contracted)
        ->between(now()->subDay()->toDateString(), null)->create();

    $rows = candidatesByRegistration($this->booking, $this->dispatcher);

    expect($rows['UAA 001A']['requires_override_reason'])->toBeFalse();
    expect($rows['UAA 002B']['requires_override_reason'])->toBeTrue();
});

it('demands a reason for nothing when the client has no contract that day', function () {
    $rows = candidatesByRegistration($this->booking, $this->dispatcher);

    expect(collect($rows)->pluck('requires_override_reason')->unique()->all())->toBe([false]);
    expect(collect($rows)->pluck('dispatchable')->unique()->all())->toBe([true]);
});

it('omits an inactive vehicle, so no caller has to know the rule', function () {
    Vehicle::factory()->create(['registration_number' => 'UAA 004D', 'status' => 'maintenance']);

    expect(candidatesByRegistration($this->booking, $this->dispatcher))->not->toHaveKey('UAA 004D');
});

it('refuses a caller who may not dispatch this booking', function () {
    $employee = User::factory()->create([
        'tenant_id' => $this->bank->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    candidatesFor($this->booking, $employee)->assertForbidden();
});

/**
 * The coherence test, and the reason this endpoint is safe to add at all.
 *
 * The list and the assignment answer the same question in two places. If
 * they ever disagree the symptom is silent: a dispatcher is offered a
 * vehicle and then refused it, or is asked for a reason the list said was
 * unnecessary. So every vehicle in the pool is actually dispatched, and the
 * real outcome is compared against what the list promised.
 */
it('promises exactly what assignment then does, for every vehicle in the pool', function () {
    VehicleAllocation::factory()
        ->forTenant($this->bank)->forVehicle($this->contracted)
        ->between(now()->subDay()->toDateString(), null)->create();

    VehicleAllocation::factory()
        ->forTenant($this->ngo)->forVehicle($this->blocked)
        ->between(now()->subDay()->toDateString(), null)->exclusive()->create();

    foreach (candidatesByRegistration($this->booking, $this->dispatcher) as $registration => $row) {
        // A fresh booking each time: assignment is a one-shot act, and
        // reusing one would make every attempt after the first fail on the
        // booking's status instead of on the allocation rules.
        $booking = Booking::factory()->forTenant($this->bank)->create();

        $response = actingAs($this->dispatcher)->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $row['id'],
            'driver_id' => $this->driver->id,
        ]);

        $expected = match (true) {
            ! $row['dispatchable'] => 409,
            $row['requires_override_reason'] => 422,
            default => 201,
        };

        expect($response->status())->toBe(
            $expected,
            "The list and the assignment disagree about {$registration}: list said "
            ."dispatchable={$row['dispatchable']}, requires_override_reason={$row['requires_override_reason']}."
        );

        // Free the vehicle again, so the next iteration is refused by the
        // allocation rules rather than by TripAssignmentGuard finding this
        // trip still occupying the driver.
        if ($response->status() === 201) {
            Trip::allTenants()->where('booking_id', $booking->id)->delete();
        }
    }
});
