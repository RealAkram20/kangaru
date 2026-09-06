<?php

namespace App\Support\Tenancy;

use App\Models\OperatorClient;
use App\Models\Tenant;
use App\Models\User;

/**
 * The clients a reader may narrow a cross-client listing to (ADR-0006).
 *
 * Served in `meta.filters.clients` alongside the page, the way
 * `AuditLogController` serves `meta.filters.actors` — so a client picker
 * holds no list of its own and cannot fall behind the one the endpoint
 * will actually accept.
 *
 * Empty for a client's own user, and that is the whole authorization
 * story: they have exactly one client, it is already applied by
 * `TenantScope`, and it was never a choice. The index requests refuse
 * `tenant_id` from them for the same reason.
 *
 * Written once and used by both `/bookings` and `/trips`, because two
 * copies of a query is how the two answer differently. ADR-0006 exists
 * largely because that had happened five times.
 */
final class ClientOptions
{
    /**
     * Every client, or none — not "the clients present on this page".
     *
     * A picker that only offered the clients already visible could not be
     * used to find the one whose row is further down, which is the reason
     * somebody reaches for it. `AuditLogController` makes the opposite
     * choice deliberately, because a trail's actors are unbounded; clients
     * are not — PROJECT.md's Phase 1 scale target is 50 tenants, so this
     * is a small, indexed read of a small table.
     *
     * @return array<int, array{value: int, label: string}>
     */
    public static function forActor(User $actor): array
    {
        if (! $actor->isPlatformLevel()) {
            return [];
        }

        return Tenant::query()
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (Tenant $tenant) => ['value' => $tenant->id, 'label' => $tenant->name])
            ->all();
    }

    /**
     * The clients a fleet may raise **new** work for — active contracts only
     * (ADR-0064 §5; owner's instruction, 24 Aug: the desk books only for the
     * clients it is assigned).
     *
     * Deliberately narrower than `forActor()`, and a separate method rather
     * than a flag, because the two answer different questions. `forActor()`
     * lists whose *existing* rows a reader may narrow to, which for a fleet
     * includes clients whose contract has ended — ADR-0060 §7 lets a
     * departed fleet keep reading its completed work. This lists who a
     * booking may be raised *for*, and an ended contract is precisely a
     * client no new car goes out to.
     *
     * `StoreBookingRequest` enforces the same predicate server-side
     * (`OperatorClient::servedBy`); this is the list that stops the dialog
     * offering an answer the server would refuse.
     *
     * @return array<int, array{value: int, label: string}>
     */
    public static function bookableBy(User $actor): array
    {
        if (! $actor->isPlatformLevel()) {
            return [];
        }

        return Tenant::query()
            ->whereIn('id', OperatorClient::query()
                ->servedBy((int) $actor->operator_id)
                ->select('tenant_id'))
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (Tenant $tenant) => ['value' => $tenant->id, 'label' => $tenant->name])
            ->all();
    }
}
