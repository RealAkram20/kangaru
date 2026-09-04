<?php

namespace Modules\Support\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Support\Models\SupportRequest;

/**
 * Who may read and answer a driver's report (ADR-0044 §3).
 *
 * A policy rather than an inline permission check, for the reason
 * `DriverSettlementRequestPolicy` records: `$this->authorize()` raises an
 * `AuthorizationException` the handler renders as the platform's API envelope,
 * where a bare `abort(403)` produces a framework error page the contract
 * validator rejects.
 *
 * **`drivers.manage` is the same compromise ADR-0032 §5 records**, and this
 * class is the same seam to cut along: when a Support role separates from
 * Fleet, one permission changes here and nothing else moves. It is not a new
 * permission today because a queue no existing role can open is a queue nobody
 * reads.
 *
 * **A driver has no ability here at all**, deliberately. They reach their own
 * reports through `/me/support-requests`, which authorises on the token — there
 * is no id in the path and therefore nothing to authorise against. If a driver
 * could `answer()`, the feature would be a driver writing the office's reply to
 * themselves.
 */
class SupportRequestPolicy
{
    /** The office queue. */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    public function view(User $user, SupportRequest $request): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    /**
     * Writing the reply.
     *
     * The same authority as reading the queue, and deliberately not a
     * narrower one: a role that can read every driver's account of a bad
     * afternoon and cannot answer any of it is a role that produces the
     * silence this feature exists to end.
     */
    public function answer(User $user, SupportRequest $request): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }
}
