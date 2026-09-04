<?php

namespace Modules\Clients\Policies;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\OperatorClient;
use App\Models\User;

/**
 * Who may do what to a contract between a fleet and a client (ADR-0060).
 *
 * Three parties and three different answers, which is why this is a policy
 * rather than a permission:
 *
 * - a **fleet** may ask, and may end its own contract;
 * - a **client** may see every contract naming them, and is the only party
 *   that may approve one;
 * - **head office** may see them — the directory is Kangaru's (ADR-0062 §1) —
 *   and may not approve, because approving would put it in the path
 *   ADR-0060 §5 deliberately kept it out of.
 *
 * A permission cannot express any of that, because the question is never
 * *what may this role do* but *whose contract is this*.
 */
class OperatorClientPolicy
{
    /**
     * The client's own list, under *Our fleets*.
     *
     * Only a client-level account: this is the surface where a **requested**
     * row is visible, and it is visible to the party being asked and to nobody
     * else. A fleet reading this would learn which of its competitors had
     * asked to serve the same client, which is precisely the disclosure
     * ADR-0060 §4 refuses.
     */
    public function viewAny(User $user): bool
    {
        return $user->access_level === AccessLevel::CLIENT
            && $user->tenant_id !== null
            && $user->hasPermission(Permission::COMPANIES_VIEW);
    }

    /**
     * A fleet asks to serve a client already on Kangaru.
     *
     * Head office is deliberately excluded. It does not ask — it onboards
     * directly, naming the fleet (ADR-0062 §3), which is a different act with
     * a different form. Letting head office use this route would be head
     * office queueing a request for a client to answer about a fleet that
     * never asked.
     */
    public function create(User $user): bool
    {
        return $user->access_level === AccessLevel::FLEET
            && $user->operator_id !== null
            && $user->hasPermission(Permission::COMPANIES_CREATE);
    }

    /**
     * **The client alone.** Not Kangaru, not the incumbent fleet.
     *
     * The single most consequential line in this file: if any other party can
     * reach it, a fleet can approve its own request and the whole
     * ask-and-wait flow collapses into a self-service read of somebody else's
     * client.
     */
    public function approve(User $user, OperatorClient $contract): bool
    {
        return $user->access_level === AccessLevel::CLIENT
            && $user->tenant_id === $contract->tenant_id
            && $user->hasPermission(Permission::COMPANIES_UPDATE);
    }

    /**
     * Either party may end it — the client because the relationship is theirs,
     * the fleet because it may resign. Head office may not: it is not a party
     * to a contract between two other organisations.
     */
    public function end(User $user, OperatorClient $contract): bool
    {
        if ($user->access_level === AccessLevel::CLIENT) {
            return $user->tenant_id === $contract->tenant_id
                && $user->hasPermission(Permission::COMPANIES_UPDATE);
        }

        return $user->access_level === AccessLevel::FLEET
            && $user->operator_id === $contract->operator_id
            && $user->hasPermission(Permission::COMPANIES_UPDATE);
    }
}
