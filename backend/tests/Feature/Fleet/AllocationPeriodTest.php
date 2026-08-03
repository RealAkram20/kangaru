<?php

use App\Models\Tenant;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Vehicles\Models\Vehicle;

/**
 * `Modules/Fleet`'s first tests.
 *
 * ADR-0009 makes `scopeInForceOn` load-bearing — it stops being dead code
 * the moment dispatch consults an allocation — and `Modules/Fleet/README.md`
 * item 7 has been saying that nothing asserts its boundary days. A contract
 * whose final day is or is not one of its days is the difference between a
 * client being owed a vehicle on the 31st and not, and it is the kind of
 * off-by-one that is invisible until a bank asks about a specific morning.
 *
 * `scopeOverlapping` gets the same treatment for the same reason: it is the
 * predicate the exclusivity rule is written in, and an overlap check that is
 * wrong at the edges is an exclusivity guarantee that is wrong at the edges.
 */
beforeEach(function () {
    // These scopes are read outside HTTP, and TenantScope fails closed.
    $this->tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($this->tenant->id);
});

/** @return array{0: Vehicle, 1: VehicleAllocation} */
function allocationRunning(string $startsOn, ?string $endsOn, Tenant $tenant): array
{
    $vehicle = Vehicle::factory()->create();

    $allocation = VehicleAllocation::factory()
        ->forTenant($tenant)
        ->forVehicle($vehicle)
        ->between($startsOn, $endsOn)
        ->create();

    return [$vehicle, $allocation];
}

describe('scopeInForceOn', function () {
    it('counts the first day of the contract', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::inForceOn(Carbon::parse('2026-08-10'))->count())->toBe(1);
    });

    /**
     * The one that decides whether a contract's last day is billable. Written
     * as its own test rather than folded into a range check so that a
     * regression names itself.
     */
    it('counts the last day of the contract', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::inForceOn(Carbon::parse('2026-08-20'))->count())->toBe(1);
    });

    it('excludes the day before it starts and the day after it ends', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::inForceOn(Carbon::parse('2026-08-09'))->count())->toBe(0);
        expect(VehicleAllocation::inForceOn(Carbon::parse('2026-08-21'))->count())->toBe(0);
    });

    it('never ends when ends_on is null', function () {
        allocationRunning('2026-08-10', null, $this->tenant);

        expect(VehicleAllocation::inForceOn(Carbon::parse('2030-01-01'))->count())->toBe(1);
        expect(VehicleAllocation::inForceOn(Carbon::parse('2026-08-09'))->count())->toBe(0);
    });
});

describe('scopeOverlapping', function () {
    /**
     * The boundary that matters most. ADR-0009 makes an exclusive allocation
     * refuse to coexist with any other for the same vehicle; if a contract
     * ending on the 20th and one starting on the 20th were treated as
     * adjacent rather than overlapping, one vehicle would be owed to two
     * clients on the same morning — the exact failure exclusivity is bought
     * to prevent.
     */
    it('treats a shared single day as an overlap', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::overlapping(
            Carbon::parse('2026-08-20'),
            Carbon::parse('2026-08-30'),
        )->count())->toBe(1);
    });

    it('does not treat genuinely adjacent periods as overlapping', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::overlapping(
            Carbon::parse('2026-08-21'),
            Carbon::parse('2026-08-30'),
        )->count())->toBe(0);

        expect(VehicleAllocation::overlapping(
            Carbon::parse('2026-08-01'),
            Carbon::parse('2026-08-09'),
        )->count())->toBe(0);
    });

    it('finds a period wholly inside another, and one wholly containing it', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::overlapping(
            Carbon::parse('2026-08-12'),
            Carbon::parse('2026-08-14'),
        )->count())->toBe(1);

        expect(VehicleAllocation::overlapping(
            Carbon::parse('2026-01-01'),
            Carbon::parse('2026-12-31'),
        )->count())->toBe(1);
    });

    /**
     * An open-ended contract ends after everything, so anything starting at
     * any point afterwards collides with it. This is the common case — the
     * Bank's own allocation states no end date — and getting it wrong would
     * make the most typical contract the one exclusivity fails to protect.
     */
    it('collides with an open-ended existing allocation however far ahead', function () {
        allocationRunning('2026-08-10', null, $this->tenant);

        expect(VehicleAllocation::overlapping(
            Carbon::parse('2030-01-01'),
            Carbon::parse('2030-02-01'),
        )->count())->toBe(1);
    });

    /** The mirror: an open-ended *candidate* collides with anything after it. */
    it('collides when the candidate is open-ended', function () {
        allocationRunning('2026-08-10', '2026-08-20', $this->tenant);

        expect(VehicleAllocation::overlapping(Carbon::parse('2026-08-15'), null)->count())->toBe(1);
        expect(VehicleAllocation::overlapping(Carbon::parse('2026-08-21'), null)->count())->toBe(0);
    });
});
