<?php

namespace Modules\Vehicles\Policies;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\User;
use Modules\Vehicles\Models\Vehicle;

/**
 * Permission-based since ADR-0004. The role sets that used to live here are
 * now the seeded grants in `RoleSeeder` — including the fact that everyone
 * may read the fleet, which was `return true` and is preserved as
 * `vehicles.view` on every system role.
 */
class VehiclePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_VIEW);
    }

    public function view(User $user, Vehicle $vehicle): bool
    {
        return $this->viewAny($user) && $this->ownedByTheSameFleet($user, $vehicle);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_MANAGE);
    }

    public function update(User $user, Vehicle $vehicle): bool
    {
        return $this->create($user) && $this->ownedByTheSameFleet($user, $vehicle);
    }

    public function delete(User $user, Vehicle $vehicle): bool
    {
        return $this->create($user) && $this->ownedByTheSameFleet($user, $vehicle);
    }

    /**
     * Whose vehicle it is — the question all three methods above discarded.
     *
     * Every one of them took a `Vehicle` and ignored it: `view` deferred to
     * `viewAny`, and `update` and `delete` both deferred to `create`, which
     * takes no vehicle at all. So a fleet owner holding `vehicles.manage` —
     * which every fleet owner holds — could **edit or delete a competitor's
     * vehicle** by putting its id in the URL. Strictly worse than the listing
     * leak found alongside it: that one disclosed a register, this one lets a
     * rival write to it.
     *
     * The signature is again the tell. A policy method that accepts the model
     * reads as one that inspects it, and Laravel makes accepting it mandatory,
     * so the parameter is present whether or not anybody uses it.
     *
     * **Head office is deliberately unaffected.** Kangaru owns no vehicle
     * (ADR-0055 §5) and reaches a fleet's by acting as somebody in it
     * (ADR-0056), at which point `$user` *is* that fleet's person and this
     * compares their fleet, not head office's absent one. Narrowing on the
     * fleet axis only is what keeps that path working.
     */
    private function ownedByTheSameFleet(User $user, Vehicle $vehicle): bool
    {
        if ($user->access_level !== AccessLevel::FLEET) {
            return true;
        }

        return $user->operator_id !== null && $user->operator_id === $vehicle->operator_id;
    }
}
