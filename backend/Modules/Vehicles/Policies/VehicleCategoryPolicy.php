<?php

namespace Modules\Vehicles\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * ADR-0050 §6. The vocabulary follows the register it describes, so the
 * permissions are `VehiclePolicy`'s exactly — view on `vehicles.view`,
 * everything else on `vehicles.manage`.
 *
 * **Reading is deliberately as wide as reading the fleet**, which is every
 * system role: the rate card dialog has to render the category choices to
 * Finance, and Finance holds `ratecards.manage` but is not a fleet role.
 * Narrowing this to `vehicles.manage` would leave the pricing screen unable
 * to name the things it prices.
 *
 * **No new permission, and no new money power.** Creating a category never
 * sets a price; every path that sets one still needs `ratecards.manage`.
 */
class VehicleCategoryPolicy
{
    /**
     * Reading the vocabulary is deliberately wider than reading the fleet.
     *
     * Two surfaces need the names and hold neither fleet permission:
     *
     * - **The rate card version dialog.** Finance holds `ratecards.manage`
     *   and, as it happens, `vehicles.view` through `$everyoneReads` — but
     *   pricing must not depend on a fleet grant that a custom role could
     *   omit.
     * - **The booking form.** A corporate client picks the kind of vehicle
     *   they want (ADR-0051), and the two corporate roles hold
     *   `$clientReads` and nothing of the fleet at all. Without this they
     *   get a 403 and an empty select.
     *
     * **This exposes names, not the roster.** "Sedan, SUV, Van" is the
     * platform's vocabulary; `docs/security-gate.md` F2 withholds *which
     * vehicles exist*, and that stays withheld — `VehicleCategoryResource`
     * omits `vehicles_count` for anyone without `vehicles.view`, because
     * how many vans Shanitah owns is roster information and commercially
     * the client's business to not know.
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_VIEW)
            || $user->hasPermission(Permission::BOOKINGS_CREATE);
    }

    /** Whether the fleet counts may be shown alongside the names. */
    public static function mayReadFleetCounts(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_VIEW);
    }

    public function view(User $user, VehicleCategory $category): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_MANAGE);
    }

    public function update(User $user, VehicleCategory $category): bool
    {
        return $this->create($user);
    }

    public function delete(User $user, VehicleCategory $category): bool
    {
        return $this->create($user);
    }
}
