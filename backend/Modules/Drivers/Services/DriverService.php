<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\StoreDriverRequest;
use Modules\Drivers\Requests\UpdateDriverRequest;
use Modules\Vehicles\Models\Vehicle;

/**
 * Plain Eloquent CRUD — no repository. Simple single-model CRUD doesn't
 * earn a repository per ADR-0002.
 *
 * No allTenants() platform-level bypass: drivers are always created by an
 * already tenant-scoped user, so BelongsToTenant auto-fills tenant_id
 * from TenantContext normally.
 */
class DriverService
{
    public function __construct(private readonly DriverAccountService $accounts) {}

    public function list(User $user): Collection
    {
        // Eager loaded because DriverResource reports whether each driver can
        // sign in, and — since ADR-0048 — what they drive; without this the
        // list is two queries per row (AGENTS.md — prevent N+1).
        //
        // **Scoped to the actor's fleet**, which it was not: this returned
        // every driver on the platform, complete with the phone and licence
        // number `docs/security-gate.md` F2 withholds from a client. The same
        // omission as `VehicleService::list()`, and worse — a driver register
        // is personal data about people who never agreed to be in a rival's
        // console.
        return Driver::forActor($user)->with(['user', 'vehicle'])->orderBy('name')->get();
    }

    /**
     * Creates the driver, and the vehicle they own if the form carried one.
     *
     * **One transaction, or neither** (ADR-0048 §8). The alternative the
     * console has today is two screens: send the clerk to Vehicles, have them
     * register the machine, come back, and find the driver form empty. A
     * half-applied version of this — a vehicle in the fleet belonging to a
     * driver whose creation then failed on a duplicate licence number — is
     * that same abandoned state, made durable and invisible.
     */
    public function create(StoreDriverRequest $request): Driver
    {
        $attributes = $request->validated();
        $vehicle = $this->pullVehicleAttributes($attributes);

        return DB::transaction(function () use ($attributes, $vehicle, $request): Driver {
            if ($vehicle !== null) {
                $attributes['vehicle_id'] = $this->registerVehicle($vehicle, $request->user());
            }

            return Driver::create($attributes);
        });
    }

    public function update(Driver $driver, UpdateDriverRequest $request): Driver
    {
        $attributes = $request->validated();
        $vehicle = $this->pullVehicleAttributes($attributes);

        DB::transaction(function () use ($driver, $attributes, $vehicle, $request): void {
            if ($vehicle !== null) {
                $attributes['vehicle_id'] = $this->registerVehicle($vehicle, $request->user());
            }

            /**
             * Un-ticking the box clears the link and **does not delete the
             * vehicle** (ADR-0048 §8).
             *
             * A checkbox that destroys a fleet record is the silent
             * destruction this codebase refuses elsewhere — ADR-0016 §5 keeps
             * the account when the link goes, for the same reason. The
             * vehicle stays and is deleted where vehicles are deleted, by
             * somebody who meant to.
             *
             * Only when the caller actually said so: a PATCH that never
             * mentions `owns_vehicle` must not clear a link it was not asked
             * about.
             */
            if (array_key_exists('owns_vehicle', $attributes)
                && ! $attributes['owns_vehicle']
                && ! array_key_exists('vehicle_id', $attributes)
                && $driver->owns_vehicle) {
                $attributes['vehicle_id'] = null;
            }

            $driver->update($attributes);
        });

        // A driver suspended on the fleet screen who can still sign in is
        // suspended on paper only: `TripPolicy::transition` asks whether
        // the trip's driver is the caller, never whether that driver is
        // allowed to drive today. ADR-0016 §5 — the account follows the
        // profile down, and does not follow it back up.
        if (($request->validated()['status'] ?? null) === 'suspended') {
            $this->accounts->suspendAccountFor($driver);
        }

        return $driver;
    }

    /**
     * The account is detached before the profile goes, for two reasons and
     * both of them bite.
     *
     * A soft delete leaves the row — and its `user_id` — in the table, so
     * the unique index added by ADR-0016 would go on reserving that account
     * against a profile nobody can see. Re-hiring the same driver would
     * then fail with a conflict naming a driver who appears not to exist.
     *
     * And a deleted driver whose token is still live keeps passing
     * `TripPolicy::transition` for any trip still pointing at them.
     */
    public function delete(Driver $driver): void
    {
        $this->accounts->close($driver);

        $driver->delete();
    }

    /**
     * Lifts the nested `vehicle` object out of the validated attributes.
     *
     * By reference, because what is left has to be safe to hand to
     * `Driver::create()` — `vehicle` is not a column, and a mass assignment
     * carrying it would be silently dropped by `$fillable` today and become a
     * confusing failure the day somebody adds a `vehicle` accessor.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>|null
     */
    private function pullVehicleAttributes(array &$attributes): ?array
    {
        $vehicle = $attributes['vehicle'] ?? null;
        unset($attributes['vehicle']);

        return is_array($vehicle) && $vehicle !== [] ? $vehicle : null;
    }

    /**
     * Creates the fleet vehicle a driver owns, and checks the permission that
     * governs the fleet before it does.
     *
     * **`vehicles.manage`, separately and explicitly** (ADR-0048 §9). Folding
     * vehicle creation into `drivers.manage` would be exactly the side door
     * ADR-0016 §1 refuses at length: a role that was never granted the fleet
     * would be able to write fleet records from a different screen, and the
     * escalation rule would be intact in one module and defeated in another.
     *
     * A clerk holding only `drivers.manage` gets the fleet picker and not the
     * inline form, and is told which permission they are missing rather than
     * being shown a form that fails on submit.
     */
    /**
     * @param  array<string, mixed>  $vehicle  the validated inline vehicle
     * @param  Authenticatable|null  $actor  whoever is signed in, of any guard
     */
    private function registerVehicle(array $vehicle, ?Authenticatable $actor): int
    {
        // `$request->user()` is `Authenticatable`, and on this platform that
        // is a `User` **or** a `Customer` — the public order flow has its own
        // guard. Narrowing here rather than at each call site keeps the rule
        // in one place, and a customer falls through to the same refusal as
        // an unauthenticated request, which is the honest answer: a customer
        // is not a fleet actor and `Gate::forUser` on one would be asking the
        // wrong policy about the wrong subject.
        if (! $actor instanceof User) {
            $actor = null;
        }

        if ($actor === null || Gate::forUser($actor)->denies('create', Vehicle::class)) {
            throw new AuthorizationException(
                'Registering a vehicle needs the fleet permission. Pick an existing vehicle instead.'
            );
        }

        return Vehicle::create($vehicle)->getKey();
    }
}
