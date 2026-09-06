<?php

namespace App\Http\Middleware;

use App\Enums\AccessLevel;
use App\Models\User;
use App\Support\Access\AccessContext;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs after auth:sanctum. Reads the authenticated user's tenant_id and
 * binds it to the request-scoped TenantContext singleton, which every
 * BelongsToTenant model reads via TenantScope. Platform-level users
 * (Super Admin, Operations Manager) have a null tenant_id and remain
 * outside tenant scoping.
 *
 * Since ADR-0013 the authenticated party may also be a `Customer`, which has
 * no tenant at all — a walk-in belongs to the platform, not to a corporate
 * client. Narrowing to `User` states that, rather than leaning on Eloquent
 * returning null for an attribute that does not exist: the same answer today,
 * for a reason that would stop being true the moment somebody adds the column
 * to `customers` for an unrelated purpose.
 */
class IdentifyTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        $tenantId = $user instanceof User ? $user->tenant_id : null;

        app(TenantContext::class)->set($tenantId);

        if ($tenantId !== null) {
            Context::add('tenant_id', $tenantId);
        }

        $this->bindAccessLevel($user);

        return $next($request);
    }

    /**
     * Bind the fleet axis from the actor's own declared level (ADR-0055 §2).
     *
     * Read from `access_level` rather than worked out from the two ownership
     * columns, which is the point of that column existing: two nulls describe
     * **Kangaru**, and every one of Shanitah's staff — including its drivers —
     * is a null-client row.
     *
     * Anyone who is not a `User` — a `Customer` since ADR-0013, or nobody at
     * all on a public route — leaves the context unbound, which is the
     * fail-closed state. That is the same answer `TenantContext` has always
     * given them, arrived at deliberately rather than by an attribute happening
     * to be absent.
     */
    private function bindAccessLevel(mixed $user): void
    {
        $access = app(AccessContext::class);

        if (! $user instanceof User) {
            $access->clear();

            return;
        }

        match ($user->access_level) {
            AccessLevel::CLIENT => $access->bindClient((int) $user->tenant_id),
            AccessLevel::FLEET => $access->bindFleet((int) $user->operator_id),
            AccessLevel::KANGARU => $access->bindKangaru(),
            // Deliberately unbound — the fail-closed state. An applicant
            // has no organisational scope at all, so every scoped read
            // returns nothing, which is the correct answer rather than an
            // omission (ADR-0055 §4, amended).
            AccessLevel::APPLICANT => $access->clear(),
        };

        /*
         * Both axes reach the error tracker, not just the client one
         * (ADR-0054).
         *
         * `tenant_id` has been added to `Context` above since ADR-0006. The
         * fleet axis needs the same treatment for a reason that only exists
         * after ADR-0055: with more than one fleet, *"is this bug everyone's or
         * one operator's"* is the first question worth asking about any error,
         * and an event that cannot answer it turns triage into guesswork.
         *
         * `access_level` rides along because it is the thing that distinguishes
         * two nulls — a client's user and a Kangaru user both have no fleet,
         * and an event tagged only `operator_id: null` cannot say which was
         * looking. That ambiguity is exactly what ADR-0055 §4 exists to remove,
         * and it would be a shame to reintroduce it in the one place somebody
         * reads when something has already gone wrong.
         *
         * Neither value is personal data, so this adds nothing for
         * `ScrubsSecrets` to strip: an operator id names a company, and a level
         * names a category of account.
         */
        Context::add('access_level', $user->access_level->value);

        if ($user->operator_id !== null) {
            Context::add('operator_id', $user->operator_id);
        }
    }
}
