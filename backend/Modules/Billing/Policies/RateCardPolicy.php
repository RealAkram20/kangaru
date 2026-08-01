<?php

namespace Modules\Billing\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Billing\Models\RateCard;

/**
 * Who may see and who may set prices.
 *
 * AGENTS.md Security: "MFA is required for Super Admin and Finance roles in
 * Phase 1 — these roles can move money and change rates." Changing rates is
 * therefore confined to exactly those two roles. An Operations Manager runs
 * the fleet and may need to see what a trip will cost; they do not set the
 * price of one.
 *
 * A Corporate Admin can read their own organisation's rate card — it is
 * their negotiated contract, and hiding it invites the disputes this module
 * exists to prevent. TenantScope (ADR-0001) is what makes "their own" true.
 *
 * MFA itself is not built yet (PROJECT.md open item), so these roles are
 * currently protected by password alone. That gap is recorded in
 * Modules/Billing/README.md rather than papered over here.
 */
class RateCardPolicy
{
    private const RATE_SETTERS = [
        UserRole::SUPER_ADMIN,
        UserRole::FINANCE,
    ];

    private const RATE_VIEWERS = [
        UserRole::SUPER_ADMIN,
        UserRole::FINANCE,
        UserRole::OPERATIONS_MANAGER,
        UserRole::CORPORATE_ADMIN,
    ];

    public function viewAny(User $user): bool
    {
        return in_array($user->role, self::RATE_VIEWERS, true);
    }

    public function view(User $user, RateCard $rateCard): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return in_array($user->role, self::RATE_SETTERS, true);
    }

    /**
     * Adding a version, and choosing which card is the tenant's default.
     * Both change what the next invoice charges, so both are a rate change.
     */
    public function update(User $user, RateCard $rateCard): bool
    {
        return $this->create($user);
    }
}
