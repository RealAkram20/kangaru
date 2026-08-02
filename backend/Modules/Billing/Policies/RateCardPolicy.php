<?php

namespace Modules\Billing\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Billing\Models\RateCard;

/**
 * Who may see and who may set prices.
 *
 * AGENTS.md Security: "MFA is required for Super Admin and Finance roles in
 * Phase 1 — these roles can move money and change rates." `ratecards.manage`
 * is therefore seeded onto exactly those two. An Operations Manager runs the
 * fleet and may need to see what a trip will cost; they do not set the price
 * of one.
 *
 * A Corporate Admin can read their own organisation's rate card — it is
 * their negotiated contract, and hiding it invites the disputes this module
 * exists to prevent. TenantScope (ADR-0001) is what makes "their own" true.
 *
 * MFA itself is not built yet (PROJECT.md open item), so these permissions
 * are currently protected by password alone. That gap is recorded in
 * Modules/Billing/README.md rather than papered over here.
 *
 * Permission-based since ADR-0004. Note the consequence: a custom role may
 * now hold `ratecards.manage` without being Super Admin or Finance, which
 * makes the MFA gap above wider rather than narrower. Whoever curates roles
 * carries that responsibility until MFA lands.
 */
class RateCardPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::RATECARDS_VIEW);
    }

    public function view(User $user, RateCard $rateCard): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::RATECARDS_MANAGE);
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
