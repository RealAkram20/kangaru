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
    /**
     * The fleet's own register, and nobody else's (ADR-0055 §3).
     *
     * **This took `$user` and ignored it.** `Vehicle::all()` returned every
     * vehicle on the platform, so the first fleet onboarded after Shanitah
     * opened its console and read Shanitah's twenty — registration numbers,
     * categories and status, the whole register of a competitor. The signature
     * is why it survived review: a method taking the actor reads as a method
     * that scopes by them, and the parameter was the only part that did.
     *
     * `BelongsToOperator` carries no global scope, deliberately and for good
     * reasons it states at length — which puts the entire burden on call sites
     * opting in. `CrossFleetIsolationTest` proved the scope itself and claimed
     * in its docblock to prove *"the opt-in scope every listing goes through"*.
     * Neither listing went through it. A correct scope nothing calls is not a
     * defence; it is a defence that has never been deployed.
     */
    public function list(User $user): Collection
    {
        return Vehicle::forActor($user)->orderBy('registration_number')->get();
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
