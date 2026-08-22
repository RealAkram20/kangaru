<?php

namespace App\Http\Middleware;

use App\Models\ImpersonationSession;
use App\Models\User;
use App\Support\Access\ImpersonationContext;
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

        // A session whose subject has been deleted, or was never a `User` —
        // the walk-in half of the morph is not implemented (ADR-0056 scope).
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
}
