<?php

namespace Modules\Customers\Services;

use App\Models\Customer;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Customers\Enums\CustomerStatus;

/**
 * Suspending and restoring a customer account (ADR-0018 §3).
 *
 * The platform previously had no way to stop one. An account placing
 * abusive orders could be deleted — losing the order history that is the
 * evidence — or left alone. Neither is an answer, so there is a third.
 */
class CustomerAdminService
{
    /**
     * Suspends the account and closes every session it holds.
     *
     * The revocation is the substance. Flipping a column while a live
     * Sanctum token keeps working means the person carries on ordering from
     * the app they already have open until the token expires — the same
     * hole `UserAdminService::revokeTokens` and ADR-0016 §5 close for staff
     * and drivers, and for the same reason: a control that only takes
     * effect at the next sign-in is not a control.
     */
    public function suspend(Customer $customer, string $reason, User $actor): Customer
    {
        return DB::transaction(function () use ($customer, $reason, $actor) {
            $customer->update([
                'status' => CustomerStatus::SUSPENDED,
                'suspended_at' => now(),
                'suspension_reason' => $reason,
                'suspended_by_user_id' => $actor->id,
            ]);

            $customer->tokens()->delete();

            return $customer->refresh();
        });
    }

    /**
     * Restores the account. Tokens are deliberately **not** restored — the
     * customer signs in again, exactly as a reinstated staff member does.
     *
     * The reason and the timestamp are cleared with it. Keeping a stale
     * "suspended because…" beside an active account is how a support agent
     * tells somebody they are blocked when they are not; the audit log is
     * where the history of the decision lives, and it is append-only.
     */
    public function restore(Customer $customer): Customer
    {
        $customer->update([
            'status' => CustomerStatus::ACTIVE,
            'suspended_at' => null,
            'suspension_reason' => null,
            'suspended_by_user_id' => null,
        ]);

        return $customer->refresh();
    }
}
