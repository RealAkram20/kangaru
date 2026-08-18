<?php

namespace Modules\Drivers\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Drivers\Models\DriverSettlementRequest;

/**
 * Who may answer a driver's settlement request (ADR-0032 §5).
 *
 * A policy rather than an inline permission check, and not only for tidiness:
 * `$this->authorize()` raises an `AuthorizationException`, which the exception
 * handler renders as the platform's API envelope. A bare `abort(403)` produces
 * a framework error page instead, and the contract validator catches it —
 * which is how this class came to exist.
 *
 * **`drivers.manage` is a compromise and ADR-0032 §5 records it as one.**
 * Confirming that money moved is closer to a Finance act than a Fleet one, and
 * AGENTS.md already requires MFA for Finance because those roles "can move
 * money and change rates". A dedicated `drivers.settle` permission is the
 * right refinement; when Finance separates from Fleet, this class is the seam
 * to cut along, and nothing else needs to change.
 *
 * **A driver has no ability here at all**, deliberately. They raise requests
 * through `/me/settlement-requests`, which authorises on the token rather than
 * on a policy — and if they could `answer()` their own, the whole feature
 * would be a self-service withdrawal and the balance would be a number the
 * person it bills controls.
 */
class DriverSettlementRequestPolicy
{
    /** The office queue. */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * Confirming or declining.
     *
     * One ability for both, because they are the same authority used two
     * ways: whoever may agree that cash moved may also say it did not.
     * Splitting them would suggest a role that can only ever say yes.
     */
    public function answer(User $user, DriverSettlementRequest $request): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }
}
