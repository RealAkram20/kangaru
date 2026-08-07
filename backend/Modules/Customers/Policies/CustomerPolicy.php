<?php

namespace Modules\Customers\Policies;

use App\Enums\Permission;
use App\Models\Customer;
use App\Models\User;

/**
 * Who among Shanitah's staff may look at the customer register (ADR-0018).
 *
 * ## Why this is not `staff.view`
 *
 * Two different populations with two different privacy stories. Staff are
 * colleagues whose names and roles the whole desk needs; customers are
 * members of the public whose phone numbers, addresses and travel history
 * fall under the Data Protection and Privacy Act, 2019 (AGENTS.md
 * Compliance). Folding them into one permission would mean anybody who can
 * see the staff list can see where every retail customer went last month.
 *
 * ## Read is wide, write is narrow
 *
 * `customers.view` is seeded on Dispatcher and Operations Manager — a
 * dispatcher answering the phone has to be able to find the caller.
 * `customers.manage` — suspending an account — is not, because it is an act
 * somebody has to answer for and it belongs with the people who do.
 *
 * ## Customers are the platform's, not a client's
 *
 * There is no tenant check here, and its absence is the point: a walk-in
 * customer is Shanitah's retail client (ADR-0013 §1), not any corporate
 * account's. A Corporate Admin holds neither permission, so the register is
 * closed to them entirely — their staff are in `/users`, which is a
 * different list about different people.
 */
class CustomerPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::CUSTOMERS_VIEW);
    }

    public function view(User $user, Customer $customer): bool
    {
        return $this->viewAny($user);
    }

    /**
     * Suspending and restoring are the same permission on purpose: a role
     * that can take an account away must be able to give it back, or a
     * mistake needs a database console to undo. The same reasoning as
     * `UserPolicy::suspend`.
     */
    public function suspend(User $user, Customer $customer): bool
    {
        return $user->hasPermission(Permission::CUSTOMERS_MANAGE);
    }
}
