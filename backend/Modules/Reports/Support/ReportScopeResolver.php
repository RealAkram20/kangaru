<?php

namespace Modules\Reports\Support;

use App\Models\User;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Enums\TenantFilter;

/**
 * Turns "who is asking, for which report, with what filter" into the one
 * thing the rest of the module needs: a {@see ReportScope} (ADR-0007).
 *
 * One class, called from four places — the two on-screen requests, the
 * export request, and the three controllers — because ADR-0006 is the
 * record of what happens when a tenancy predicate is written out wherever
 * it happens to be needed. Five copies in four modules, and the sixth is
 * the one that gets it backwards.
 *
 * This class does not authorize anything. `Gate::viewReport` still answers
 * *what* a user may see and is unchanged by ADR-0007; this answers *whose*.
 * The two compose exactly as ADR-0006 set out, and a platform Dispatcher is
 * still refused the financial report by the policy before this is ever
 * consulted.
 */
class ReportScopeResolver
{
    /**
     * Whether this actor may pass `tenant_id` to this report at all.
     *
     * False for every client user, on every report: they have exactly one
     * tenant and it is not theirs to choose. The request classes use this
     * to decide whether `tenant_id` is on the whitelist, so a client who
     * sends it gets the ordinary "not a filter this report accepts" 422
     * rather than a bespoke error — and, importantly, is never told whether
     * the id they guessed exists.
     */
    public function accepts(ReportType $report, User $actor): bool
    {
        return $actor->isPlatformLevel()
            && $report->tenantFilter() !== TenantFilter::NOT_ACCEPTED;
    }

    /**
     * Whether this actor must pass `tenant_id` to this report.
     *
     * Only ever true for platform staff on the financial report. A client
     * is never required to name a tenant, because theirs is not in
     * question.
     */
    public function requires(ReportType $report, User $actor): bool
    {
        return $actor->isPlatformLevel()
            && $report->tenantFilter() === TenantFilter::REQUIRED;
    }

    /**
     * The scope this request runs under.
     *
     * Assumes validation has already run — that a client did not supply
     * `$requestedTenantId`, and that a platform user supplied one where the
     * report requires it. Both are enforced in the request classes, where a
     * failure is a 422 the user can read, rather than here, where it would
     * be an exception.
     *
     * The client branch is first and unconditional: whatever a client's
     * request contains, their report is about their own tenant. There is no
     * path through this method by which a client user reaches
     * `allClients()`.
     */
    public function resolve(ReportType $report, User $actor, ?int $requestedTenantId): ReportScope
    {
        if (! $actor->isPlatformLevel()) {
            // Not `$requestedTenantId ?? $actor->tenant_id` — that would
            // honour a filter this class has just said clients may not
            // send, and one bypassed validation away from being a
            // cross-tenant read.
            return ReportScope::tenant((int) $actor->tenant_id);
        }

        if ($requestedTenantId !== null && $this->accepts($report, $actor)) {
            return ReportScope::tenant($requestedTenantId);
        }

        return ReportScope::allClients();
    }
}
