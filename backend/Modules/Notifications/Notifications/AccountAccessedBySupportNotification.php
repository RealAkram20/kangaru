<?php

namespace Modules\Notifications\Notifications;

use App\Models\ImpersonationSession;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells somebody that Kangaru support held their account (ADR-0056 §5).
 *
 * ## Why this exists at all
 *
 * ADR-0056 reverses a refusal this codebase states twice, on one condition:
 * that the audit trail can tell a borrowed identity apart from the person's
 * own hand. The trail does that now — but **a trail nobody is told to look at
 * deters nothing**. This is the half the person actually reads.
 *
 * ## What it does not say
 *
 * Not the reason the agent typed. That is written for the office and an
 * auditor — it carries ticket numbers, internal shorthand and sometimes a
 * third party's name, and forwarding it verbatim to the person the session was
 * *about* would leak the support desk's own notes to them. They are told that
 * it happened, by whom, and when; if they want the why, the office answers.
 *
 * Nor the agent's email address. A name is accountability; a personal address
 * is a target, and the platform has no reason to hand one out.
 *
 * ## Timing
 *
 * Sent when the session **begins**, not when it ends. A person whose account
 * is being used should hear about it while it is happening, not after — and a
 * session that is abandoned rather than stopped would otherwise never send at
 * all, which is precisely the case worth hearing about.
 */
class AccountAccessedBySupportNotification extends KangaruNotification
{
    public function __construct(
        private readonly string $subjectName,
        private readonly string $actorName,
        private readonly string $startedAt,
    ) {}

    public static function for(ImpersonationSession $session, string $subjectName, string $actorName): self
    {
        return new self($subjectName, $actorName, $session->started_at->toDayDateTimeString());
    }

    public function type(): NotificationType
    {
        return NotificationType::ACCOUNT_ACCESSED_BY_SUPPORT;
    }

    public function subject(): string
    {
        return 'KangaruRide support opened your account';
    }

    public function body(): string
    {
        return "{$this->subjectName}, {$this->actorName} from KangaruRide support signed in to your "
            ."account on {$this->startedAt} to help with a query. Everything they did is recorded "
            .'against their name as well as yours, and they cannot change your password, your '
            .'second factor, or where your money is paid. '
            .'If you were not expecting this, contact the office.';
    }

    public function url(): ?string
    {
        // Nowhere useful to send them. There is no screen where a person reads
        // their own access history yet — `AuditLogController` is the office's
        // reader, not theirs — and a link into a page that answers 403 is
        // worse than no link. Named in the module README as the gap it is.
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'actor_name' => $this->actorName,
            'started_at' => $this->startedAt,
        ];
    }
}
