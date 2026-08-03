<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADR-0008 decision 3: enrolment is forced, not nagged.
 *
 * A user whose role requires a second factor and who has not set one up can
 * authenticate and then do **nothing except enrol**. Every other endpoint
 * refuses them.
 *
 * The alternative was a banner and a grace period, and the argument that
 * settled it is that a grace period is a rollout strategy and there was no
 * rollout: the platform is not live, so the affected population was two
 * seeded demo accounts. A grace period would have bought a deadline, a nag,
 * an enforcement job and a window of known non-compliance, in order to be
 * kind to nobody.
 *
 * ## Why a middleware and not a check in each controller
 *
 * The same reason ADR-0006 made `BindSubjectTenant` middleware: a rule
 * enforced per-controller is a rule that is missing from the controller
 * somebody adds next month, and the failure mode here is a Finance officer
 * issuing invoices without the factor the bank was told they use. This runs
 * on the authenticated group as a whole, so a new route is covered by
 * existing on arrival.
 *
 * ## Fails open only for the unauthenticated
 *
 * With no user there is nothing to enforce and `auth:sanctum` has already
 * refused the request, so passing through is correct rather than a hole.
 */
class EnsureMfaEnrolled
{
    /**
     * The routes a user in this state may still reach.
     *
     * Deliberately tiny, and deliberately a route-name list rather than a
     * path prefix: `auth/mfa/*` as a prefix would also open
     * `auth/mfa/verify`, which belongs to the *other* half of the flow and
     * is reached without a token at all.
     *
     * `auth.logout` is here because trapping somebody in an application
     * they cannot leave is its own bug — and signing out is the correct
     * response to "I do not have my phone with me".
     *
     * `auth.me` is here because the SPA needs to know *why* it is being
     * refused everything else. Without it the client can only show a blank
     * screen, which is the failure this project has shipped before.
     *
     * @var array<int, string>
     */
    private const ALLOWED_ROUTES = [
        'auth.me',
        'auth.logout',
        'auth.password.change',
        'auth.mfa.enrol',
        'auth.mfa.enrol.confirm',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User || ! $user->mustEnrolInMfa()) {
            return $next($request);
        }

        if (in_array($request->route()?->getName(), self::ALLOWED_ROUTES, true)) {
            return $next($request);
        }

        // 403 with a machine-readable code, not a redirect: this is an API,
        // and the client branches on `code` (AGENTS.md). The message says
        // what happened and what to do next, because a refusal a user
        // cannot act on is indistinguishable from a broken product.
        return ApiResponse::error(
            ErrorCode::MFA_ENROLMENT_REQUIRED,
            'Your role requires two-factor authentication. Set up an authenticator app to continue.',
            [],
            403,
        );
    }
}
