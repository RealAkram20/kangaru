<?php

namespace Modules\Clients\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Clients\Models\ClientRoute;

/**
 * ADR-0045 §9: the client builds; Shanitah reads.
 *
 * ## Why writing is refused to platform staff, and not merely unseeded
 *
 * A Super Admin holds every permission in the catalogue, `routes.manage`
 * included, so a permission check alone would let one through. It must not,
 * for two reasons that happen to agree.
 *
 * The **design** reason is the ADR's: a bank's cash circuit is the bank's
 * operational decision, and the whole premise of the corporate panel is that
 * the client stops phoning Shanitah to change their own data.
 *
 * The **mechanical** reason is the one that would bite first. Platform staff
 * belong to no tenant (ADR-0006), so `BelongsToTenant` has nothing to
 * auto-fill `tenant_id` from and the insert would fail on a NOT NULL column
 * — `CompanyPolicy` records the same trap from the other side, where
 * `companies.create` reaches for `allTenants()` precisely because of it.
 * A refusal that says "this is the client's to do" is a better answer than
 * an integrity constraint violation.
 *
 * Reading is the opposite: `forActor()` drops the tenant scope for platform
 * staff, so a dispatcher with `routes.view` reads every client's circuits
 * and can make sense of a multi-stop trip on the live map.
 */
class ClientRoutePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::ROUTES_VIEW);
    }

    public function view(User $user, ClientRoute $route): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->mayBuild($user);
    }

    public function update(User $user, ClientRoute $route): bool
    {
        return $this->mayBuild($user);
    }

    public function delete(User $user, ClientRoute $route): bool
    {
        return $this->mayBuild($user);
    }

    /**
     * The permission and the tenancy, together, because neither alone is
     * the question. See the class docblock.
     */
    private function mayBuild(User $user): bool
    {
        return ! $user->isPlatformLevel()
            && $user->hasPermission(Permission::ROUTES_MANAGE);
    }
}
