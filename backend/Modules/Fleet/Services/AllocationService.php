<?php

namespace Modules\Fleet\Services;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Modules\Fleet\Models\VehicleAllocation;

/**
 * Agreeing and ending a vehicle allocation, and the one rule that decides
 * whether an allocation may exist at all.
 *
 * ## The rule (ADR-0009 §3)
 *
 * - Non-exclusive allocations for one vehicle **may overlap freely.** A
 *   vehicle contracted to two clients who each get priority over strangers
 *   is a coherent arrangement and a likely one.
 * - An exclusive allocation **may not overlap any other allocation** for the
 *   same vehicle, exclusive or not. Exclusivity that coexists with another
 *   contract is not exclusivity.
 *
 * Both directions are checked, because the conflict is symmetric: agreeing
 * an exclusive contract over an existing ordinary one is the same collision
 * as agreeing an ordinary one over an existing exclusive contract, and only
 * checking the first would let the second in through the back door.
 *
 * ## Why this is a service and not a constraint (ADR-0009 §4)
 *
 * MySQL 8 cannot express "no two rows for this vehicle with overlapping date
 * ranges". There is no exclusion constraint — that is PostgreSQL's `EXCLUDE
 * USING gist` — a `UNIQUE` index cannot describe a range predicate, and a
 * `CHECK` cannot see other rows.
 *
 * So the guarantee lives here, in application code, which makes it a race
 * unless it is locked. Two concurrent exclusive allocations for one vehicle
 * would both read zero conflicts and both insert. It gets the same treatment
 * AGENTS.md already mandates for dispatch assignment, and for the same
 * reason: `SELECT ... FOR UPDATE` on the **vehicle row** inside the
 * transaction that writes the allocation.
 *
 * The vehicle row is the correct thing to serialise on, exactly as in
 * `TripAssignmentGuard`: the contended resource is the vehicle, the row
 * always exists, and locking only the allocations that already exist would
 * let two racers who each find none proceed together.
 *
 * **Because the guarantee is code rather than schema, the race test is the
 * constraint.** `tests/Concurrency/AllocationRaceTest.php` is the only thing
 * holding it, which is why ADR-0009 makes it mandatory.
 */
class AllocationService
{
    /**
     * @param  array{vehicle_id: int, tenant_id: int, starts_on: string, ends_on: string|null, exclusive?: bool, notes?: string|null}  $attributes
     *
     * @throws AllocationConflictException
     */
    public function agree(array $attributes, User $actor): VehicleAllocation
    {
        return DB::transaction(function () use ($attributes, $actor) {
            $vehicleId = $attributes['vehicle_id'];
            $exclusive = $attributes['exclusive'] ?? false;

            $startsOn = Carbon::parse($attributes['starts_on']);
            $endsOn = $attributes['ends_on'] === null ? null : Carbon::parse($attributes['ends_on']);

            $this->assertNoConflict($vehicleId, $startsOn, $endsOn, $exclusive);

            return VehicleAllocation::create([
                ...$attributes,
                'exclusive' => $exclusive,
                'created_by_user_id' => $actor->id,
            ]);
        });
    }

    /**
     * Ends an allocation on a given day, inclusive.
     *
     * Ending never conflicts: a contract can only shrink here, and a shorter
     * period cannot overlap anything the longer one did not. So this needs
     * no lock — the invariant it might threaten only moves in the safe
     * direction.
     */
    public function end(VehicleAllocation $allocation, CarbonInterface $endsOn): VehicleAllocation
    {
        $allocation->ends_on = $endsOn;
        $allocation->save();

        return $allocation->refresh();
    }

    /**
     * MUST run inside a transaction — `lockForUpdate()` outside one is
     * released immediately and buys nothing, which is how a check like this
     * passes every test and still races in production.
     *
     * @throws AllocationConflictException
     */
    private function assertNoConflict(
        int $vehicleId,
        CarbonInterface $startsOn,
        ?CarbonInterface $endsOn,
        bool $exclusive,
    ): void {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException(
                'AllocationService must run inside a transaction; lockForUpdate outside one is a no-op.'
            );
        }

        // Lock the vehicle itself. Raw and tenant-scope-free because this is
        // a lock acquisition whose result is discarded, not a data read
        // (ADR-0001's raw-query exception).
        DB::table('vehicles')->where('id', $vehicleId)->lockForUpdate()->first();

        // `allTenants()` is essential, not incidental. The whole question is
        // whether *somebody else's* contract stands in the way, and
        // TenantScope would hide precisely those rows — leaving a check that
        // passes because it cannot see the thing it is looking for, which is
        // worse than no check at all.
        $conflicts = VehicleAllocation::allTenants()
            ->where('vehicle_id', $vehicleId)
            ->overlapping($startsOn, $endsOn)
            // A non-exclusive candidate only collides with an exclusive
            // incumbent; an exclusive candidate collides with anything.
            ->when(! $exclusive, fn ($query) => $query->where('exclusive', true))
            ->exists();

        if ($conflicts) {
            throw new AllocationConflictException($vehicleId, $exclusive);
        }
    }
}
