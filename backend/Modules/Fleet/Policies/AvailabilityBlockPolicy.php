<?php

namespace Modules\Fleet\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Models\AvailabilityBlock;

/**
 * Who may take a driver or a vehicle off the road (ADR-0017 §5).
 *
 * No permission of its own. Recording that a vehicle is in the workshop is
 * the same authority as editing that vehicle, and inventing
 * `availability.manage` would mean a new grant that has to be seeded onto
 * exactly the roles that already hold `vehicles.manage` — a second name for
 * an existing thing, and one more row for an operator to get wrong.
 *
 * So the permission follows the *resource*: `drivers.manage` for a driver's
 * leave, `vehicles.manage` for a vehicle's service. A depot manager who may
 * book a van in for a service but may not sign a driver off sick is a real
 * distinction in a real fleet, and this preserves it for free.
 *
 * Reading is deliberately wider — `drivers.view` / `vehicles.view`, held by
 * every system role — because a dispatcher who cannot see that a vehicle is
 * blocked will keep trying to dispatch it.
 */
class AvailabilityBlockPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_VIEW)
            || $user->hasPermission(Permission::VEHICLES_VIEW);
    }

    public function view(User $user, AvailabilityBlock $block): bool
    {
        return $user->hasPermission($this->readPermissionFor($block->resource_type));
    }

    public function createFor(User $user, AvailabilityResource $resource): bool
    {
        return $user->hasPermission($this->writePermissionFor($resource));
    }

    /**
     * Ending a block early is the same authority as creating one.
     *
     * A vehicle released from the workshop a day early has to be
     * dispatchable that day, and a fleet that cannot correct its own record
     * without a database console will simply stop keeping the record.
     */
    public function delete(User $user, AvailabilityBlock $block): bool
    {
        return $this->createFor($user, $block->resource_type);
    }

    /**
     * Answering a request for time off (ADR-0017 §6).
     *
     * Same permission as recording one — deciding whether a driver has
     * Friday off is the same authority as writing that they do.
     *
     * With one refusal on top: **you may not answer your own request.** The
     * Driver's Application will let a driver ask, and some of the people who
     * hold `drivers.manage` also drive; self-approval would turn a request
     * into a formality and leave an audit trail that reads as an approval
     * when nobody approved anything. Same reasoning as `UserPolicy` refusing
     * to let an account change its own role.
     */
    public function respond(User $user, AvailabilityBlock $block): bool
    {
        if (! $block->isAnswered() && $block->created_by_user_id === $user->id) {
            return false;
        }

        return $this->createFor($user, $block->resource_type);
    }

    /**
     * Whether this account may ask for its own time off (ADR-0017 §6).
     *
     * Deliberately **not** a permission. Asking is not an authority — it is
     * something any driver may do about their own roster, and inventing
     * `availability.request` would mean a grant that has to be seeded onto
     * the driver role and every custom driving role somebody later makes.
     * Forget it once and a driver silently cannot ask for leave.
     *
     * The real gate is having a driver profile at all, which the controller
     * checks by looking one up — an account with none has no roster to ask
     * about. This method exists so the route still carries an explicit
     * `authorize()` call, per AGENTS.md's rule that a route without a policy
     * check fails review.
     */
    public function requestOwn(User $user): bool
    {
        return true;
    }

    private function writePermissionFor(AvailabilityResource $resource): Permission
    {
        return match ($resource) {
            AvailabilityResource::DRIVER => Permission::DRIVERS_MANAGE,
            AvailabilityResource::VEHICLE => Permission::VEHICLES_MANAGE,
        };
    }

    private function readPermissionFor(AvailabilityResource $resource): Permission
    {
        return match ($resource) {
            AvailabilityResource::DRIVER => Permission::DRIVERS_VIEW,
            AvailabilityResource::VEHICLE => Permission::VEHICLES_VIEW,
        };
    }
}
