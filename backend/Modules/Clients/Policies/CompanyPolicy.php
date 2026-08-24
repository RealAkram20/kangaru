<?php

namespace Modules\Clients\Policies;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\User;
use Modules\Clients\Models\Company;

/**
 * Permission-based since ADR-0004.
 *
 * Creating a company stays a platform-level act: `companies.create` is
 * seeded only on Super Admin, because a Super Admin has no tenant context
 * to auto-fill `tenant_id` from and the controller reaches for
 * `Company::allTenants()->create(...)` accordingly.
 */
class CompanyPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::COMPANIES_VIEW);
    }

    public function view(User $user, Company $company): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::COMPANIES_CREATE);
    }

    public function update(User $user, Company $company): bool
    {
        return $user->hasPermission(Permission::COMPANIES_UPDATE);
    }

    public function delete(User $user, Company $company): bool
    {
        return $user->hasPermission(Permission::COMPANIES_DELETE);
    }

    /**
     * Setting which fleets serve this client (owner's decision, 24 August).
     *
     * **Head office alone**, and gated on the level rather than on a
     * permission, for the reason `DriverWalkInContractPolicy::approve` gives
     * about its own step: a permission can be granted to a custom role, and
     * this must not be grantable. A fleet that could reach it would add itself
     * to any client on the platform — which is the entire flow ADR-0060 §4
     * built the ask-and-wait path to prevent, defeated from a different URL.
     *
     * A client's own administrator is refused too, though they hold
     * `companies.update` for their own profile. Re-sourcing yourself onto a
     * fleet that has not agreed is not a profile edit; a client wanting a new
     * fleet is answering that fleet's request, which is `ContractController`.
     *
     * ADR-0060 §5 still stands where it was aimed: a **fleet** cannot take a
     * client, and `ContractController::store` is untouched and still asks.
     */
    public function assignFleets(User $user, Company $company): bool
    {
        return $user->access_level === AccessLevel::KANGARU
            && $user->hasPermission(Permission::COMPANIES_UPDATE);
    }
}
