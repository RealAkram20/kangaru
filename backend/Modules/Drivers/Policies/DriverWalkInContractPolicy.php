<?php

namespace Modules\Drivers\Policies;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\User;
use Modules\Drivers\Models\DriverWalkInContract;

/**
 * Who may answer a walk-in contract (ADR-0055 §5).
 *
 * Three parties, three answers, and **no party may perform another's step**:
 *
 * - a **fleet** consents or refuses for its own driver, and can do neither
 *   once Kangaru has answered;
 * - **Kangaru** approves or refuses, and cannot consent on a fleet's behalf;
 * - a **driver** asks and may withdraw, and can do neither of the above.
 *
 * The one that would collapse the feature: **if a driver could reach
 * `approve`, every driver on the platform is contracted the moment they ask**,
 * and their fleet is never consulted. That is why `approve` is keyed on the
 * level rather than on a permission — a permission can be granted to a custom
 * role, and this must not be grantable.
 *
 * `WalkInContractService` separately refuses an out-of-order transition. Two
 * gates on one door because they answer different questions: this asks *are
 * you the right party*, the service asks *is it your turn*.
 */
class DriverWalkInContractPolicy
{
    /**
     * The queue. A fleet sees requests naming it; head office sees everything
     * consented and waiting on them. Scoped in the controller — this decides
     * only whether there is a queue for this actor at all.
     */
    public function viewAny(User $user): bool
    {
        if ($user->access_level === AccessLevel::KANGARU) {
            return $user->hasPermission(Permission::DRIVERS_VIEW);
        }

        return $user->access_level === AccessLevel::FLEET
            && $user->operator_id !== null
            && $user->hasPermission(Permission::DRIVERS_VIEW);
    }

    /**
     * The fleet's own step, and only for its own driver.
     *
     * `operator_id` is compared against the **contract's** row rather than the
     * driver's current fleet: a driver who has since moved employer must not
     * hand their consent decision to whoever they work for now.
     */
    public function consent(User $user, DriverWalkInContract $contract): bool
    {
        return $user->access_level === AccessLevel::FLEET
            && $user->operator_id !== null
            && $user->operator_id === $contract->operator_id
            && $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * Head office's step, and head office's alone.
     *
     * Keyed on the **level**, not a permission. A permission can be given to a
     * custom role, and the whole ask-consent-approve chain rests on this not
     * being grantable to the parties it is meant to sit above.
     */
    public function approve(User $user, DriverWalkInContract $contract): bool
    {
        return $user->access_level === AccessLevel::KANGARU
            && $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * Refusing is whoever's turn it is — so it is the union of the two above,
     * and the service decides which timestamp the refusal stamps from the
     * state rather than from the caller.
     */
    public function refuse(User $user, DriverWalkInContract $contract): bool
    {
        return $this->consent($user, $contract) || $this->approve($user, $contract);
    }

    /** Ending a live contract is Kangaru's: it is Kangaru's economy. */
    public function end(User $user, DriverWalkInContract $contract): bool
    {
        return $this->approve($user, $contract);
    }
}
