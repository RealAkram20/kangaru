<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Fleet\Services\AllocationConflictException;
use Modules\Fleet\Services\AllocationService;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0009 §3, the rule itself. The race that guards it lives in
 * `tests/Concurrency/AllocationRaceTest.php`; this file is about what the
 * rule *says*, with one attempt at a time.
 */
beforeEach(function () {
    $this->bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $this->ngo = Tenant::factory()->create(['name' => 'Acme NGO']);
    $this->vehicle = Vehicle::factory()->create();
    $this->actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    app(TenantContext::class)->set($this->bank->id);

    $this->service = app(AllocationService::class);
});

/** @return array<string, mixed> */
function allocationPayload(Tenant $tenant, Vehicle $vehicle, string $from, ?string $to, bool $exclusive): array
{
    return [
        'vehicle_id' => $vehicle->id,
        'tenant_id' => $tenant->id,
        'starts_on' => $from,
        'ends_on' => $to,
        'exclusive' => $exclusive,
    ];
}

it('lets two non-exclusive allocations overlap freely', function () {
    $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-01', '2026-09-30', false),
        $this->actor,
    );

    $second = $this->service->agree(
        allocationPayload($this->ngo, $this->vehicle, '2026-09-15', '2026-10-15', false),
        $this->actor,
    );

    // The coherent, likely arrangement ADR-0009 protects: one vehicle
    // contracted to two clients who each rank above strangers.
    expect($second->exists)->toBeTrue();
    expect(VehicleAllocation::allTenants()->where('vehicle_id', $this->vehicle->id)->count())->toBe(2);
});

it('refuses an exclusive allocation that overlaps an ordinary one', function () {
    $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-01', '2026-09-30', false),
        $this->actor,
    );

    $attempt = fn () => $this->service->agree(
        allocationPayload($this->ngo, $this->vehicle, '2026-09-15', '2026-10-15', true),
        $this->actor,
    );

    expect($attempt)->toThrow(AllocationConflictException::class);
    expect(VehicleAllocation::allTenants()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
});

/**
 * The mirror, and the one an asymmetric check would let through: the
 * exclusive contract already exists and an ordinary one is agreed over it.
 * Exclusivity that only holds against later exclusive contracts is not
 * exclusivity.
 */
it('refuses an ordinary allocation that overlaps an exclusive one', function () {
    $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-01', '2026-09-30', true),
        $this->actor,
    );

    $attempt = fn () => $this->service->agree(
        allocationPayload($this->ngo, $this->vehicle, '2026-09-15', '2026-10-15', false),
        $this->actor,
    );

    expect($attempt)->toThrow(AllocationConflictException::class);
});

it('allows an exclusive allocation that touches nothing', function () {
    $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-01', '2026-09-30', false),
        $this->actor,
    );

    $later = $this->service->agree(
        allocationPayload($this->ngo, $this->vehicle, '2026-10-01', '2026-10-31', true),
        $this->actor,
    );

    expect($later->exclusive)->toBeTrue();
});

/**
 * The conflict must be found across tenants — that is the entire point.
 * TenantScope is bound to the Bank throughout this test, so a check that
 * forgot `allTenants()` would see zero rows and cheerfully allow the
 * collision. This asserts the check looks where the danger actually is.
 */
it('finds a conflicting allocation belonging to a different client', function () {
    // Written while bound to the NGO...
    app(TenantContext::class)->set($this->ngo->id);
    $this->service->agree(
        allocationPayload($this->ngo, $this->vehicle, '2026-09-01', '2026-09-30', true),
        $this->actor,
    );

    // ...and challenged while bound to the Bank, which cannot see it.
    app(TenantContext::class)->set($this->bank->id);
    expect(VehicleAllocation::query()->where('vehicle_id', $this->vehicle->id)->count())
        ->toBe(0, 'Precondition: the incumbent must be invisible under the current tenant scope.');

    $attempt = fn () => $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-10', '2026-09-20', false),
        $this->actor,
    );

    expect($attempt)->toThrow(AllocationConflictException::class);
});

it('leaves a different vehicle alone', function () {
    $other = Vehicle::factory()->create();

    $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-01', '2026-09-30', true),
        $this->actor,
    );

    $fine = $this->service->agree(
        allocationPayload($this->ngo, $other, '2026-09-01', '2026-09-30', true),
        $this->actor,
    );

    expect($fine->exists)->toBeTrue();
});

it('can end an allocation, and the freed days then accept an exclusive contract', function () {
    $allocation = $this->service->agree(
        allocationPayload($this->bank, $this->vehicle, '2026-09-01', null, false),
        $this->actor,
    );

    $this->service->end($allocation, Carbon::parse('2026-09-10'));

    // The 11th onwards is now free, so an exclusive contract may take it.
    $exclusive = $this->service->agree(
        allocationPayload($this->ngo, $this->vehicle, '2026-09-11', '2026-09-30', true),
        $this->actor,
    );

    expect($exclusive->exists)->toBeTrue();
    expect($allocation->fresh()->ends_on->toDateString())->toBe('2026-09-10');
});

/*
 * There is deliberately no test that `assertNoConflict` refuses to run
 * outside a transaction, though the guard exists and matters.
 *
 * `RefreshDatabase` wraps every test in one, so `DB::transactionLevel()` is
 * never 0 inside this suite and the guard cannot be provoked. Writing a test
 * that asserts it anyway would pass for the wrong reason, or would need the
 * suite's isolation strategy changed for a single case — a much larger risk
 * than the one it covers. It is a developer-facing tripwire, and it is
 * recorded here as untested rather than left to look tested.
 */
