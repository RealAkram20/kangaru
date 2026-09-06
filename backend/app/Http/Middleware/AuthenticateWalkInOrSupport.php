<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Models\Customer;
use App\Models\ImpersonationSession;
use App\Models\User;
use App\Support\Access\ImpersonationContext;
use App\Support\Api\ApiResponse;
use Closure;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * The customer guard, plus exactly one named exception (ADR-0066 §3).
 *
 * ## What this replaces, and why it is not `auth:customer` plus something
 *
 * The walk-in surface answered to a `customers`-provider token and nothing
 * else, and ADR-0013 §2 made that structural rather than conventional:
 * `config/auth.php` pins the `sanctum` guard's provider so that "a customer
 * request cannot even reach a staff policy" is true in both directions, with
 * `CustomerGuardIsolationTest` as the tripwire.
 *
 * ADR-0056 then promised head office could *"log in as to any fleet, corporate
 * client, walk-in client and drivers"*, and three of those four are `users`
 * rows that `ActAsSubject` can swap. The fourth is not a `users` row at all, so
 * there is nothing to swap **to** — the reach has to come from the other side,
 * on the customer's own surface.
 *
 * Stacking `auth:customer` with a second middleware could not express it: the
 * first would have rejected the staff token before the second ever ran. So the
 * two answers live in one class, tried in order, and the fallthrough is the
 * whole of the exception.
 *
 * ## The three properties, and each is a test
 *
 * - **A staff token with no live session is refused**, exactly as before. The
 *   isolation test's claim is not weakened, it is made conditional, and the
 *   condition is a row somebody created on the record.
 * - **No customer token is minted.** `setUserResolver`, not a guard login —
 *   ADR-0056 §1's *"never mints a client-app token"*, and it is what keeps the
 *   exception revocable: end the session and the reach ends with it, with
 *   nothing left behind in a browser to be replayed.
 * - **The customer comes from the session, never from the request.** There is
 *   no id in any of these URLs to tamper with, which is the property ADR-0013
 *   §4 chose for `/rides/active` and for the same reason.
 *
 * ## Expiry needs no sweeper
 *
 * `live()` stops matching, so the next request is simply an unauthenticated
 * staff token on a customer route — a 401, which is the fail-closed direction.
 * Nothing has to run for the time-box to bite, which is `ActAsSubject`'s
 * argument and worth repeating here because this is the class where somebody
 * would be tempted to cache the answer.
 *
 * ## `AuthenticatesRequests`, which is a marker and is load-bearing
 *
 * The interface declares nothing. It is what `bootstrap/app.php` anchors its
 * priority list to — `ActAsSubject`, `EnsureMfaEnrolled` and
 * `EnforceTokenScope` are all appended *after* it, and every one of them reads
 * `$request->user()`.
 *
 * Without it this class is unprioritized, so it lands after the whole api
 * group, and those three run first against a null user and wave everything
 * through. `EnforceTokenScope` is the one that matters: it is what stops a
 * **driver-app** token — scoped to a fixed route list — from reaching a
 * surface nobody granted it. Nothing would have failed; the check would simply
 * have stopped happening, which is `bootstrap/app.php`'s own warning about
 * this exact list, arriving through a different door.
 */
class AuthenticateWalkInOrSupport implements AuthenticatesRequests
{
    public function handle(Request $request, Closure $next): Response
    {
        // The ordinary case, and the overwhelming majority of traffic: a
        // walk-in with their own token. Asked first so that a customer's
        // request never touches the impersonation table at all.
        $customer = Auth::guard('customer')->user();

        if ($customer instanceof Customer) {
            Auth::shouldUse('customer');

            return $next($request);
        }

        // Resolved through the staff guard explicitly rather than through
        // `$request->user()`: the default guard here is `customer`, which has
        // already answered null, and `$request->user()` would answer null
        // again without ever looking at the bearer token.
        $actor = Auth::guard('sanctum')->user();

        if (! $actor instanceof User) {
            return $this->refuse();
        }

        $session = ImpersonationSession::query()
            ->live()
            ->where('actor_user_id', $actor->getKey())
            ->latest('started_at')
            ->first();

        if (! $session instanceof ImpersonationSession) {
            // A staff token on the walk-in surface with nothing authorising
            // it. This is the branch `CustomerGuardIsolationTest` asserts, and
            // it must stay a plain 401 — an error that named acting-as would
            // tell every holder of a staff token that the door exists.
            return $this->refuse();
        }

        $subject = $session->subject;

        if (! $subject instanceof Customer) {
            // A live session against a `User`. That session's reach is on the
            // staff surface, where `ActAsSubject` has already applied it, and
            // it buys nothing here.
            return $this->refuse();
        }

        app(ImpersonationContext::class)->begin($session);

        $request->setUserResolver(fn () => $subject);

        // So `Auth::user()` inside a controller answers the same person as
        // `$request->user()`. Without it the two disagree for one request,
        // which is the kind of split that produces a null-object crash three
        // frames from the cause.
        Auth::shouldUse('customer');
        Auth::guard('customer')->setUser($subject);

        return $next($request);
    }

    private function refuse(): Response
    {
        return ApiResponse::error(
            ErrorCode::UNAUTHENTICATED,
            'Sign in to continue.',
            status: 401,
        );
    }
}
