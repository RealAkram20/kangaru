<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Support\Api\ApiResponse;
use App\Support\Auth\ClientScope;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps a token issued to one client app inside that app's surface
 * (ADR-0022).
 *
 * Applied to the whole authenticated API rather than to the routes a driver
 * may use, and that inversion is the design. Marking the *allowed* routes
 * would mean every new endpoint is open to every token until somebody
 * remembers to close it; here a new endpoint is closed until somebody
 * decides to open it. Only one of those two mistakes is silent.
 *
 * Console tokens hold `*` and pass straight through, so the staff web app
 * is untouched.
 */
class EnforceTokenScope
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();

        // No token means either an unauthenticated route (nothing to scope)
        // or session auth. Neither is this middleware's business.
        if (! $token instanceof PersonalAccessToken) {
            return $next($request);
        }

        if (ClientScope::permits($token->abilities ?? [], $request->route()?->getName())) {
            return $next($request);
        }

        return ApiResponse::error(
            ErrorCode::TOKEN_SCOPE_EXCEEDED,
            'This app is not allowed to use that part of the API. Sign in on the web console if you need it.',
            [],
            403,
        );
    }
}
