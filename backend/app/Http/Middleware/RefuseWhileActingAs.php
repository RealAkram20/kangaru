<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Support\Access\ImpersonationContext;
use App\Support\Api\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuses an act reserved to the person themselves (ADR-0056 §3).
 *
 * ## The rule, not the list
 *
 * *"Anything whose entire purpose is to prove it was the person."* A password,
 * a second factor, where their money is sent, ending their own account. Support
 * borrowing an identity must not be able to do the things that **establish**
 * identity — and money leaving the platform on a borrowed one is the classic
 * fraud path, which is why settlement approval is on the same list.
 *
 * ## Attached to routes, never matched against route names
 *
 * A deny-list that compares `$request->route()->getName()` against an array is
 * one rename away from silently permitting what it was written to refuse, and
 * the failure is invisible: the endpoint keeps working, for everybody. This is
 * applied *to* the route instead, so it travels with it — a route that moves
 * file, prefix or name keeps its guard, and a route that loses it loses it in a
 * diff somebody reviews.
 *
 * `ClientScope` makes the same argument for the opposite reason: its allow-list
 * is by name and **fails closed**, so an unlisted route is refused. A deny-list
 * has the opposite property, and this is how that property is avoided.
 *
 * ## Why 403 with a reason rather than a bare refusal
 *
 * ADR-0056 §3: the support agent is told *why*, "so [they are] not left
 * thinking the feature is broken — which is how deny-lists get worked around".
 * A refusal that looks like a bug gets reported as one, and the report is
 * answered by somebody removing the guard.
 */
class RefuseWhileActingAs
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! app(ImpersonationContext::class)->isActing()) {
            return $next($request);
        }

        return ApiResponse::error(
            ErrorCode::FORBIDDEN,
            'This can only be done by the account holder themselves, and you are acting as '
            .'them for support. End the session and ask them to do it (ADR-0056).',
            status: 403,
        );
    }
}
