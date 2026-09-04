<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Models\Customer;
use App\Models\ImpersonationSession;
use App\Models\User;
use App\Support\Access\ImpersonationContext;
use App\Support\Api\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Swaps the authenticated user for the person they are acting as (ADR-0056).
 *
 * ## Why the swap happens here and not in each service
 *
 * ADR-0056 §1: *"`AccessContext` is the subject's… scoping, route-model
 * binding and policies behave exactly as they do for the subject, because they
 * are looking at the subject."* Doing it once, before `IdentifyTenant`, is what
 * makes that true without a single call site knowing. The alternative — every
 * scope and policy asking "am I impersonating?" — is the five-copies problem
 * ADR-0006 already solved once, with a worse failure mode: the copy that
 * forgets reads as the wrong person.
 *
 * **Order matters and is asserted by the tests.** This runs after
 * `auth:sanctum` (there must be somebody to swap) and *before*
 * `IdentifyTenant`, which builds `AccessContext` from `$request->user()`. Put
 * it after, and the session would carry the *actor's* fleet — a Kangaru
 * account's, which is none — and every scoped read would come back empty while
 * looking like it worked.
 *
 * ## What is deliberately not swapped
 *
 * The **permissions** are the subject's, and only the subject's. There is no
 * union: ADR-0056 §1 sets the actor's own `kangaru` reach aside entirely for
 * the duration, because the account that can become anybody must not also
 * carry its own powers into every room it enters. Nothing here re-adds them,
 * and `ImpersonationContext` is read by the audit trail and the banner, never
 * by anything that builds a query.
 *
 * ## Expiry is enforced on read, not by a job
 *
 * A session that has timed out is simply not found by `live()`, so the next
 * request is the actor as themselves. Nothing has to sweep the table, and a
 * scheduler that stops running cannot leave a session standing — which is the
 * failure mode `docs/master-plan.md` calls the one it most fears, and the
 * reason the time-box is a predicate rather than a cron.
 */
class ActAsSubject
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->user();

        if (! $actor instanceof User) {
            return $next($request);
        }

        $session = ImpersonationSession::query()
            ->live()
            ->where('actor_user_id', $actor->getKey())
            ->latest('started_at')
            ->first();

        if ($session === null) {
            return $next($request);
        }

        $subject = $session->subject;

        // The walk-in half (ADR-0066 §5). There is no `users` row to swap to,
        // so the staff surface is **closed** for the duration instead.
        //
        // ADR-0056 §1 sets the actor's own reach aside entirely while a
        // session is open. For a `User` subject the swap below makes that true
        // without anything having to enforce it — the actor is simply gone. A
        // `Customer` has no staff identity to replace them with, so falling
        // through here would leave the actor holding their full `kangaru`
        // reach, and acting-as-a-walk-in would be the **one** session that is
        // additive rather than substitutive. For the one account that can
        // become anybody.
        if ($subject instanceof Customer) {
            app(ImpersonationContext::class)->begin($session);

            return $this->allowsWhileHoldingAWalkIn($request)
                ? $next($request)
                : ApiResponse::error(
                    ErrorCode::FORBIDDEN,
                    'You are holding a walk-in customer\'s account for support, and a walk-in has no '
                    .'console. Stop the session to use your own (ADR-0066).',
                    status: 403,
                );
        }

        // A session whose subject has been deleted, or is neither principal.
        // Falling through as the actor is the safe direction: they are a
        // Kangaru account, which reads Kangaru's own rows and nothing else.
        if (! $subject instanceof User) {
            return $next($request);
        }

        app(ImpersonationContext::class)->begin($session);

        // `setUserResolver`, not a guard login: nothing is persisted, no token
        // is minted, and the swap lasts exactly one request. ADR-0056 §1 is
        // explicit that acting-as "never mints a client-app token" — a driver
        // token handed to a support agent would let them register a push
        // device and take a real job off a driver on the road.
        $request->setUserResolver(fn () => $subject);

        return $next($request);
    }

    /**
     * The four staff routes that stay open while a walk-in session is live
     * (ADR-0066 §5).
     *
     * ## An allow-list, and the opposite shape to `RefuseWhileActingAs`
     *
     * That class argues at length for attaching a deny-list *to* routes rather
     * than matching names, because a deny-list that misses a route **permits**
     * it and the failure is invisible. This is the mirror image and the
     * argument inverts with it: an allow-list that misses a route **refuses**
     * it. A staff route added next month is closed here until somebody opens
     * it in a diff, which is `ClientScope`'s shape and the fail-closed
     * direction.
     *
     * Each of the four earns its place:
     *
     * - `auth.me` — the console shell cannot render without it, and the shell
     *   is what draws the banner that explains the refusals.
     * - `auth.logout` — never trap somebody inside a session they cannot leave.
     * - `support.act-as.show` — how the banner learns it should be drawn.
     * - `support.act-as.destroy` — the way out.
     *
     * An unnamed route is refused. Every route this could plausibly need is
     * named, and "it had no name" is not a reason to open the console.
     */
    private function allowsWhileHoldingAWalkIn(Request $request): bool
    {
        $name = $request->route()?->getName();

        return in_array($name, [
            'auth.me',
            'auth.logout',
            'support.act-as.show',
            'support.act-as.destroy',
        ], true);
    }
}
