<?php

namespace Modules\Fleet\Services;

use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Modules\Fleet\Models\VehicleAllocation;

/**
 * What is contracted to whom on a given day.
 *
 * The one place dispatch asks Fleet a question. `Modules/Fleet/README.md`
 * draws the boundary explicitly — recording the contract is Fleet's job,
 * *choosing a vehicle for a booking* is `Modules/Dispatch`'s — so the
 * ranking and the override live over there and only the lookup lives here.
 *
 * Every read is `allTenants()`. The questions are "is this vehicle
 * contracted to *this* client" and "is it exclusively contracted to
 * *somebody else*", and the second cannot be answered from inside one
 * tenant's scope: TenantScope would hide precisely the row that forbids the
 * dispatch, turning a refusal into a silent allow. That is the same trap
 * `AllocationService` avoids for the same reason.
 */
class AllocationLookup
{
    /**
     * Vehicle ids contracted to this client on this day.
     *
     * @return Collection<int, int>
     */
    public function vehiclesFor(int $tenantId, CarbonInterface $on): Collection
    {
        return VehicleAllocation::allTenants()
            ->where('tenant_id', $tenantId)
            ->inForceOn($on)
            ->pluck('vehicle_id')
            ->map(fn ($id) => (int) $id);
    }

    /**
     * The exclusive contract barring this vehicle from this client's work on
     * this day, if there is one.
     *
     * Returns null when the vehicle is free to be dispatched — including
     * when the exclusive contract is the client's *own*, which bars nobody
     * from their own trips and is the entire point of buying one.
     */
    public function exclusiveBlockFor(int $vehicleId, int $tenantId, CarbonInterface $on): ?VehicleAllocation
    {
        return VehicleAllocation::allTenants()
            ->where('vehicle_id', $vehicleId)
            ->where('exclusive', true)
            ->where('tenant_id', '!=', $tenantId)
            ->inForceOn($on)
            ->first();
    }
}
