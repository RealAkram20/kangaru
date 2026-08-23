<?php

namespace Modules\Administration\Services;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\AuditLog;
use App\Models\ImpersonationSession;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Notifications\AccountAccessedBySupportNotification;
use Throwable;

/**
 * Beginning and ending a support session (ADR-0056).
 *
 * Every refusal in here is one of the ADR's decisions made unavoidable. They
 * are in a service rather than a FormRequest because two of them — chaining
 * and the already-open session — are about *state*, not about the shape of a
 * payload, and a validator that reads the database to answer them is a
 * validator that will be skipped by the first caller who does not use it.
 */
class ImpersonationService
{
    /**
     * @throws AuthorizationException|ValidationException
     */
    public function begin(User $actor, User $subject, string $reason, ?string $ip = null): ImpersonationSession
    {
        $this->assertMayAct($actor, $subject);

        return DB::transaction(function () use ($actor, $subject, $reason, $ip) {
            $session = ImpersonationSession::create([
                'actor_user_id' => $actor->getKey(),
                'subject_type' => $subject->getMorphClass(),
                'subject_id' => $subject->getKey(),
                'reason' => $reason,
                'started_at' => now(),
                'expires_at' => now()->addMinutes(ImpersonationSession::LIFETIME_MINUTES),
                'ip_address' => $ip,
            ]);

            // The session's own start is audited, not only the acts inside it
            // (ADR-0056 §2): "a session that opened, looked, and changed
            // nothing must still leave a record — reading a bank's trip
            // history is the act, whether or not anything was written."
            //
            // Written by hand rather than by `Auditable`, because the trait
            // would recurse: `AuditLog::record()` reads the live session to
            // fill `impersonator_id`, so auditing the session's own creation
            // would attribute it to itself.
            AuditLog::create([
                'tenant_id' => $subject->tenant_id,
                'user_id' => $actor->getKey(),
                'auditable_type' => $session->getMorphClass(),
                'auditable_id' => $session->getKey(),
                'action' => 'created',
                'changes' => ['after' => [
                    'subject_id' => $subject->getKey(),
                    'subject_email' => $subject->email,
                    'reason' => $reason,
                    'expires_at' => $session->expires_at->toIso8601String(),
                ]],
                'ip_address' => $ip,
            ]);

            $this->tellTheSubject($session, $actor, $subject);

            return $session;
        });
    }

    /**
     * The half of the disclosure the person actually reads (ADR-0056 §5).
     *
     * Their audit trail already records it, and **a trail nobody is told to
     * look at deters nothing**. The ADR asks for a notification to
     * *individuals* — drivers and walk-in customers — rather than to everybody:
     * a client's transport officer and a fleet's dispatcher act in a corporate
     * capacity and their organisation reads the same event in its own log; a
     * driver's account is their livelihood and nobody reads anything on their
     * behalf.
     *
     * **Sent at the start, not the end.** A person whose account is being used
     * should hear while it is happening — and a session that is abandoned
     * rather than stopped would otherwise never send at all, which is exactly
     * the case worth hearing about.
     *
     * Failure to notify never fails the session. A support agent locked out
     * because a mail host is down helps nobody, and the audit row — the part
     * that is actually load-bearing — is already written.
     */
    private function tellTheSubject(ImpersonationSession $session, User $actor, User $subject): void
    {

        if (! Driver::query()->where('user_id', $subject->getKey())->exists()) {
            return;
        }

        try {
            $subject->notify(
                AccountAccessedBySupportNotification::for($session, $subject->name, $actor->name)
            );
        } catch (Throwable $e) {
            report($e);
        }
    }

    public function end(ImpersonationSession $session): ImpersonationSession
    {
        if ($session->ended_at !== null) {
            return $session;
        }

        return DB::transaction(function () use ($session) {
            $session->forceFill(['ended_at' => now()])->save();

            AuditLog::create([
                'tenant_id' => null,
                'user_id' => $session->actor_user_id,
                'auditable_type' => $session->getMorphClass(),
                'auditable_id' => $session->getKey(),
                'action' => 'updated',
                'changes' => ['after' => ['ended_at' => $session->ended_at?->toIso8601String()]],
                'ip_address' => null,
            ]);

            return $session;
        });
    }

    /**
     * @throws AuthorizationException|ValidationException
     */
    private function assertMayAct(User $actor, User $subject): void
    {
        // Kangaru **and** the permission. ADR-0056 §6: `support.act-as` "is not
        // implied by any other" — not by being head office, not by being a
        // Super Admin. Being able to become anybody is granted, never inherited.
        if ($actor->access_level !== AccessLevel::KANGARU) {
            throw new AuthorizationException(
                'Only a Kangaru account can act as another user (ADR-0056).'
            );
        }

        if (! $actor->hasPermission(Permission::SUPPORT_ACT_AS)) {
            throw new AuthorizationException(
                'Acting as another user needs the '.Permission::SUPPORT_ACT_AS->value.' permission.'
            );
        }

        if ($subject->is($actor)) {
            throw ValidationException::withMessages([
                'subject_id' => ['You are already yourself.'],
            ]);
        }

        // **No chaining** (ADR-0056 §1). Acting as another head-office account
        // is how a support agent would reach `support.act-as` itself and then
        // become anybody a second time, with the trail naming the wrong person
        // at every hop.
        if ($subject->access_level === AccessLevel::KANGARU) {
            throw ValidationException::withMessages([
                'subject_id' => ['A Kangaru account cannot be acted as. Sessions do not chain.'],
            ]);
        }

        // One at a time. Two live sessions would make "who is this request"
        // depend on which row `latest()` returned, and the middleware picks
        // exactly one — so the second would be silently ignored rather than
        // refused, which is the shape of a bug nobody reports.
        $open = ImpersonationSession::query()
            ->live()
            ->where('actor_user_id', $actor->getKey())
            ->exists();

        if ($open) {
            throw ValidationException::withMessages([
                'subject_id' => ['End the session you already have open before starting another.'],
            ]);
        }
    }
}
