<?php

namespace App\Http\Middleware;

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
 */
class IdentifyTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = $request->user()?->tenant_id;

        app(TenantContext::class)->set($tenantId);

        if ($tenantId !== null) {
            Context::add('tenant_id', $tenantId);
        }

        return $next($request);
    }
}
