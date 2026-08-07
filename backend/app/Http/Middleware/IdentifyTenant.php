<?php

namespace App\Http\Middleware;

use App\Models\User;
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

        return $next($request);
    }
}
