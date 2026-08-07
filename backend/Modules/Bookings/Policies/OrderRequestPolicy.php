<?php

namespace Modules\Bookings\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;

/**
 * ADR-0012 §4: walk-in requests are worked exclusively by platform staff
 * holding `order_requests.manage`. Corporate roles never hold it, and both
 * checks are explicit rather than one implying the other — a tenant user
 * whose custom role somehow gained the permission still reads nothing,
 * because a walk-in is not their tenant's data to see.
 */
class OrderRequestPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->isPlatformLevel()
            && $user->hasPermission(Permission::ORDER_REQUESTS_MANAGE);
    }

    public function view(User $user, OrderRequest $orderRequest): bool
    {
        return $this->viewAny($user);
    }

    public function update(User $user, OrderRequest $orderRequest): bool
    {
        return $this->viewAny($user);
    }
}
