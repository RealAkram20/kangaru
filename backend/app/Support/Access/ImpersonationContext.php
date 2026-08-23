<?php

namespace App\Support\Access;

use App\Models\ImpersonationSession;
use App\Models\User;

/**
 * Who is *really* making this request, when it is not the person it looks like
 * (ADR-0056).
 *
 * Bound as a singleton beside `AccessContext` and set by `ActAsSubject`
 * middleware. `AccessContext` answers *what may this request see*, resolved
 * entirely from the subject; this answers *whose hand is on it*, which nothing
 * else needs to know except the audit trail.
 *
 * Keeping them apart is the design. If the impersonator leaked into scoping,
 * an acting-as session would see the union of two people's reach — which is
 * precisely the privilege escalation ADR-0056 §1 refuses: *"the actor's own
 * `kangaru` reach is set aside entirely while the session is open."* This class
 * is therefore **read by `AuditLog` and by the banner, and by nothing that
 * builds a query.**
 *
 * ## Unbound is the normal case
 *
 * Almost every request in this platform is somebody acting as themselves. Null
 * here means exactly that, and `AuditLog` writes a null `impersonator_id`,
 * which is what every row written before ADR-0056 already carries.
 */
final class ImpersonationContext
{
    private ?ImpersonationSession $session = null;

    public function isActing(): bool
    {
        return $this->session !== null;
    }

    public function session(): ?ImpersonationSession
    {
        return $this->session;
    }

    /**
     * The real hand behind this request, or null when there is not one.
     *
     * Read by `AuditLog::record()`. Deliberately returns an id rather than a
     * model: the audit path runs on every write and must not add a query to
     * each one.
     */
    public function actorId(): ?int
    {
        return $this->session?->actor_user_id;
    }

    public function begin(ImpersonationSession $session): void
    {
        $this->session = $session;
    }

    public function clear(): void
    {
        $this->session = null;
    }

    /**
     * Whether this request may perform an act reserved to the person
     * themselves (ADR-0056 §3).
     *
     * The rule rather than the list: **anything whose entire purpose is to
     * prove it was the person.** A password, a second factor, where their
     * money is sent, ending their own account. Support borrowing an identity
     * must not be able to do the things that establish identity.
     *
     * Expressed as a question the caller asks, not as a middleware that
     * guesses from the route name — a deny-list keyed on route names is one
     * rename away from silently permitting what it was written to refuse.
     */
    public function forbidsActsReservedToTheSubject(): bool
    {
        return $this->isActing();
    }

    /**
     * Whether the acting party is the subject themselves.
     *
     * Convenience for the two call sites that must distinguish "J. Okello
     * changed their password" from "support did, while holding J. Okello's
     * account".
     */
    public function isSelf(User $subject): bool
    {
        return ! $this->isActing() || $this->session?->subject_id === $subject->getKey();
    }
}
