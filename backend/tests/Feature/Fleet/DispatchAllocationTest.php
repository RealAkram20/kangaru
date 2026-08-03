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
 * ADR-0009 §1 and §2 at the point they actually bind: assignment.
 *
 * Deliberately exercised over HTTP against `POST
 * /bookings/{booking}/assignment` rather than against the service, because
 * the rule has to hold for a dispatcher who posts a vehicle id by hand. A
 * constraint that only exists in the candidate list somebody was shown is
 * not a constraint.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);

    $this->bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $this->ngo = Tenant::factory()->create(['name' => 'Acme NGO']);

    $this->dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
    $this->driver = Driver::factory()->create();

    $this->contracted = Vehicle::factory()->create();
    $this->pool = Vehicle::factory()->create();

    $this->booking = Booking::factory()->forTenant($this->bank)->create();
});

/**
 * The trip this booking produced.
 *
 * Scoped to the fixture rather than reaching for `Trip::first()`, because
 * the concurrency suite's race children commit outside `RefreshDatabase`'s
 * transaction and leave rows behind in the test database. A global `first()`
 * or `count()` then answers differently depending on which files ran before
 * this one — a test that passes or fails by run order, which is worse than
 * one that simply fails.
 */
function tripFor(Booking $booking): Trip
{
    return Trip::allTenants()->where('booking_id', $booking->id)->sole();
}

function assignBooking(Booking $booking, Vehicle $vehicle, Driver $driver, User $as, array $extra = [])
{
    return actingAs($as)->postJson("/api/v1/bookings/{$booking->id}/assignment", [
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        ...$extra,
    ]);
}

describe('exclusivity is a hard refusal', function () {
    it('refuses a vehicle contracted exclusively to another client', function () {
        VehicleAllocation::factory()
            ->forTenant($this->ngo)->forVehicle($this->pool)
            ->between(now()->subDay()->toDateString(), null)->exclusive()->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher)
            ->assertStatus(409)
            ->assertJsonPath('code', 'VEHICLE_EXCLUSIVELY_ALLOCATED');

        expect(Trip::allTenants()->where('booking_id', $this->booking->id)->count())->toBe(0);
    });

    /**
     * A reason must not buy a way past exclusivity. ADR-0009 is explicit
     * that there is no override — that is what exclusivity was bought.
     */
    it('still refuses when an override reason is supplied', function () {
        VehicleAllocation::factory()
            ->forTenant($this->ngo)->forVehicle($this->pool)
            ->between(now()->subDay()->toDateString(), null)->exclusive()->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher, [
            'allocation_override_reason' => 'The client asked for this one.',
        ])->assertStatus(409);

        expect(Trip::allTenants()->where('booking_id', $this->booking->id)->count())->toBe(0);
    });

    it("allows a client's own exclusive vehicle on their own booking", function () {
        VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->contracted)
            ->between(now()->subDay()->toDateString(), null)->exclusive()->create();

        assignBooking($this->booking, $this->contracted, $this->driver, $this->dispatcher)
            ->assertCreated();
    });

    /** An expired exclusive contract bars nobody. */
    it('allows a vehicle whose exclusive contract has ended', function () {
        VehicleAllocation::factory()
            ->forTenant($this->ngo)->forVehicle($this->pool)
            ->between(now()->subMonth()->toDateString(), now()->subDay()->toDateString())
            ->exclusive()->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher)
            ->assertCreated();
    });
});

describe('an ordinary allocation ranks rather than refuses', function () {
    it('requires a reason to pass over a contracted vehicle', function () {
        VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->contracted)
            ->between(now()->subDay()->toDateString(), null)->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher)
            ->assertStatus(422)
            ->assertJsonValidationErrors('allocation_override_reason');

        expect(Trip::allTenants()->where('booking_id', $this->booking->id)->count())->toBe(0);
    });

    it('records the reason on the trip when one is given', function () {
        VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->contracted)
            ->between(now()->subDay()->toDateString(), null)->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher, [
            'allocation_override_reason' => 'Contracted vehicle is in for a service until Thursday.',
        ])->assertCreated();

        expect(tripFor($this->booking)->allocation_override_reason)
            ->toBe('Contracted vehicle is in for a service until Thursday.');
    });

    it('needs no reason to use the contracted vehicle itself', function () {
        VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->contracted)
            ->between(now()->subDay()->toDateString(), null)->create();

        assignBooking($this->booking, $this->contracted, $this->driver, $this->dispatcher)
            ->assertCreated();

        // Null is a positive statement that nothing was overridden.
        expect(tripFor($this->booking)->allocation_override_reason)->toBeNull();
    });

    /**
     * The ordinary case, and the one that decides whether this feature is
     * usable. A client with no contracted vehicle has nothing to override,
     * so demanding a reason would put a required field on every dispatch —
     * which is how a required field becomes one everybody types "n/a" into.
     */
    it('needs no reason when the client has nothing contracted that day', function () {
        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher)
            ->assertCreated();

        expect(tripFor($this->booking)->allocation_override_reason)->toBeNull();
    });

    it('needs no reason when the contract had not started yet', function () {
        VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->contracted)
            ->between(now()->addWeek()->toDateString(), null)->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher)
            ->assertCreated();
    });

    it('treats whitespace as no reason at all', function () {
        VehicleAllocation::factory()
            ->forTenant($this->bank)->forVehicle($this->contracted)
            ->between(now()->subDay()->toDateString(), null)->create();

        assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher, [
            'allocation_override_reason' => '   ',
        ])->assertStatus(422)->assertJsonValidationErrors('allocation_override_reason');
    });
});

/**
 * Another client's allocation must not make a reason owed. The lookup runs
 * `allTenants()` by necessity, and the risk of that is over-reach in the
 * other direction — asking the Bank's dispatcher to explain not using a
 * vehicle the NGO contracted.
 */
it("ignores another client's ordinary allocation entirely", function () {
    VehicleAllocation::factory()
        ->forTenant($this->ngo)->forVehicle($this->contracted)
        ->between(now()->subDay()->toDateString(), null)->create();

    assignBooking($this->booking, $this->pool, $this->driver, $this->dispatcher)
        ->assertCreated();

    expect(tripFor($this->booking)->allocation_override_reason)->toBeNull();
});
