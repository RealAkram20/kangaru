<?php

namespace Modules\Fleet\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Fleet\Models\VehicleAllocation;

/**
 * Permission-based, per ADR-0004.
 *
 * Reading and agreeing are deliberately different abilities. An allocation
 * is a commercial arrangement rather than an operational fact: a dispatcher
 * needs to see it to understand why a vehicle ranks first, and a corporate
 * admin is a party to their own, but neither of them agrees contracts.
 * `allocations.manage` is seeded to the Super Admin alone.
 *
 * Row-level tenancy is not this policy's job. `VehicleAllocation` is
 * `BelongsToTenant`, so a client's reads are already narrowed by TenantScope
 * and another tenant's row 404s at model binding — never 403, per AGENTS.md.
 * Platform staff read across every client through `forActor()`, which is the
 * ADR-0006 shape and is applied in the service rather than here.
 */
class VehicleAllocationPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::ALLOCATIONS_VIEW);
    }

    public function view(User $user, VehicleAllocation $allocation): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::ALLOCATIONS_MANAGE);
    }

    /** Ending a contract early is the same commercial act as agreeing one. */
    public function update(User $user, VehicleAllocation $allocation): bool
    {
        return $this->create($user);
    }
}
