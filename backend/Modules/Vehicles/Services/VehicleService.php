<?php

namespace Modules\Vehicles\Services;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Requests\StoreVehicleRequest;
use Modules\Vehicles\Requests\UpdateVehicleRequest;

/**
 * Plain Eloquent CRUD — no repository. Simple single-model CRUD doesn't
 * earn a repository per ADR-0002.
 *
 * Unlike CompanyService, no allTenants() platform-level bypass is needed:
 * vehicles are always created by an already tenant-scoped user (Fleet
 * Owner, Branch Manager, Depot Manager, ...), so BelongsToTenant's
 * bootBelongsToTenant() auto-fills tenant_id from TenantContext normally.
 */
class VehicleService
{
    public function list(User $user): Collection
    {
        return Vehicle::all();
    }

    public function create(StoreVehicleRequest $request): Vehicle
    {
        return Vehicle::create($request->validated());
    }

    public function update(Vehicle $vehicle, UpdateVehicleRequest $request): Vehicle
    {
        $vehicle->update($request->validated());

        return $vehicle;
    }

    public function delete(Vehicle $vehicle): void
    {
        $vehicle->delete();
    }
}
