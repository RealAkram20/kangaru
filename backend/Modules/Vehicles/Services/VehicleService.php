<?php

namespace Modules\Vehicles\Services;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Modules\Trips\Enums\TripStatus;
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

    /**
     * Retire several vehicles at once, or none of them.
     *
     * ## Why all-or-nothing
     *
     * Every other outcome is worse to read. Deleting the nine that were
     * allowed and skipping the tenth leaves an administrator to work out
     * *which* nine from a table that has just changed under them — and this
     * is the one action in the module that removes rows. Refusing the batch
     * costs a deselect and a second click; a partial batch costs a
     * reconciliation. The refusals below name every vehicle and its reason,
     * so the second attempt is informed rather than a guess.
     *
     * `SoftDeletes` makes this recoverable either way (`Vehicle` uses it), and
     * that is a safety net rather than the design: an action nobody can
     * predict is not made safe by being undoable in a database console.
     *
     * ## What is refused, and why each is a refusal rather than an error
     *
     * - **Not found, or not this fleet's.** One reason for both, deliberately:
     *   telling a fleet owner that a vehicle exists but belongs to somebody
     *   else discloses a competitor's register by id (ADR-0055 §3), which is
     *   the leak `list()` above was fixed for. The caller filters to the
     *   actor's own fleet, so an unknown id and a rival's are indistinguishable
     *   from here — and must stay so.
     * - **Out on a job.** `TripStatus::occupyingValues()` is the platform's one
     *   definition of a vehicle that is busy, shared with dispatch's
     *   availability check rather than restated — a second opinion about what
     *   "in use" means is how the two would drift. Deleting one mid-trip would
     *   take the vehicle off a live journey's record.
     *
     * @param  array<int, int>  $ids
     * @return array{deleted: array<int, int>, refused: array<int, array{id: int, registration_number: string|null, reason: string}>}
     */
    public function deleteMany(User $user, array $ids): array
    {
        // Scoped to the actor's own fleet before anything else, so every id
        // below is one this user may act on at all.
        $found = Vehicle::forActor($user)->whereIn('id', $ids)->get()->keyBy('id');

        $busy = DB::table('trips')
            ->whereNull('deleted_at')
            ->whereIn('status', TripStatus::occupyingValues())
            ->whereIn('vehicle_id', $found->keys()->all())
            ->pluck('vehicle_id')
            ->map(fn ($id) => (int) $id)
            ->flip();

        $refused = [];

        foreach ($ids as $id) {
            $vehicle = $found->get($id);

            if ($vehicle === null) {
                $refused[] = [
                    'id' => $id,
                    'registration_number' => null,
                    'reason' => 'This vehicle is not on your fleet.',
                ];

                continue;
            }

            if ($busy->has($id)) {
                $refused[] = [
                    'id' => $id,
                    'registration_number' => $vehicle->registration_number,
                    'reason' => 'Out on a job. It can be deleted once the trip is finished.',
                ];
            }
        }

        if ($refused !== []) {
            return ['deleted' => [], 'refused' => $refused];
        }

        // One transaction: the promise above is that the batch either happens
        // or does not, and a failure halfway through the loop would break it
        // exactly when the database is already unhappy.
        DB::transaction(function () use ($found) {
            $found->each(fn (Vehicle $vehicle) => $vehicle->delete());
        });

        return ['deleted' => array_values($ids), 'refused' => []];
    }
}
