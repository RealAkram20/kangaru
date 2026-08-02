<?php

namespace App\Http\Middleware;

use App\Concerns\BelongsToTenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADR-0006 Decision 4: **a mutation by platform staff binds the tenant of
 * the record being acted on, not the actor's.**
 *
 * `IdentifyTenant` binds the actor's own tenant and, for Shanitah's staff,
 * that is null — they belong to no client. `BelongsToTenant::creating`
 * auto-fills `tenant_id` from the context, so a platform dispatcher
 * assigning Centenary Bank's booking would create a trip with a null
 * `tenant_id` and hit a non-nullable foreign key. On a nullable column it
 * is worse: a row belonging to nobody, invisible to the client whose work
 * it is.
 *
 * The actor is platform-level; the *work* is always some client's. This
 * middleware reads that client off the route's own bound record.
 *
 * ## Why here rather than in each service
 *
 * Route-model binding has already resolved the subject by the time this
 * runs, and it is the same subject the policy is about to authorize and the
 * service is about to mutate. Doing it per-service instead would be the
 * fifth-copy problem ADR-0006 exists to end, with a worse failure mode:
 * a service that forgot it writes a tenant-less row into a client's history.
 *
 * Ordering is not optional — `bootstrap/app.php` forces this after
 * `SubstituteBindings`, because before it there is no subject to read.
 */
class BindSubjectTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->user();

        // A client's own user is already bound to their own tenant, and the
        // subject can only ever be that same tenant's — TenantScope saw to
        // that during binding. Nothing to do, and nothing to override.
        if (! $actor instanceof User || ! $actor->isPlatformLevel()) {
            return $next($request);
        }

        $tenantId = $this->subjectTenantId($request);

        if ($tenantId === null) {
            return $next($request);
        }

        Context::add('tenant_id', $tenantId);

        /** @var TenantContext $context */
        $context = app(TenantContext::class);

        // Bound for the rest of the request rather than around a callback:
        // the mutation, its audit row, its trip_events and its notifications
        // all happen downstream of here, and TenantContext is per-request.
        // `TenantContext::for()` is the callback-scoped form, for code that
        // is not a request.
        return $context->for($tenantId, fn () => $next($request));
    }

    /**
     * The tenant of the record this route is about, or null if it is not
     * about one — an index, or a route whose parameters are all scalars.
     *
     * The **first** tenant-owned parameter wins. Route parameters are
     * ordered as the URI declares them, so on `/trips/{trip}/events` that is
     * the trip, which is the record the request is about; anything nested
     * below it belongs to the same client by construction.
     */
    private function subjectTenantId(Request $request): ?int
    {
        foreach ($request->route()?->parameters() ?? [] as $parameter) {
            if (! $parameter instanceof Model) {
                continue;
            }

            if (! in_array(BelongsToTenant::class, class_uses_recursive($parameter), true)) {
                continue;
            }

            $tenantId = $parameter->getAttribute('tenant_id');

            if ($tenantId !== null) {
                return (int) $tenantId;
            }
        }

        return null;
    }
}
