<?php

namespace Modules\Clients\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Clients\Models\ClientPlace;

/**
 * The register a route is built out of (ADR-0045 §1).
 *
 * Identical in shape to `ClientRoutePolicy` and gated on the same two
 * permissions, deliberately: pinning a place and ordering the pins are one
 * job done on one screen, and a client whose officer could build a circuit
 * but not add the ATM to put in it would have a switch that does nothing —
 * the reasoning `ClientCapability` applies to every bundle it defines.
 *
 * Separate policies rather than one shared class because they guard
 * different models and Laravel resolves by model; the duplication is four
 * lines and the alternative is a policy that has to ask what it was handed.
 */
class ClientPlacePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::ROUTES_VIEW);
    }

    public function view(User $user, ClientPlace $place): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->mayBuild($user);
    }

    public function update(User $user, ClientPlace $place): bool
    {
        return $this->mayBuild($user);
    }

    public function delete(User $user, ClientPlace $place): bool
    {
        return $this->mayBuild($user);
    }

    /**
     * @see ClientRoutePolicy::mayBuild() for why platform staff are refused
     *      the write half even holding the permission.
     */
    private function mayBuild(User $user): bool
    {
        return ! $user->isPlatformLevel()
            && $user->hasPermission(Permission::ROUTES_MANAGE);
    }
}
