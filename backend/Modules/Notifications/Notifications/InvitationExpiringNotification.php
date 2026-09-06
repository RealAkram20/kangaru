<?php

namespace Modules\Notifications\Notifications;

use Modules\Administration\Models\Invitation;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * "Your invitation expires tomorrow."
 *
 * One reminder, twenty four hours out, and never a second. A nag on a schedule
 * is the notification fatigue AGENTS.md warns about in its purest form: it
 * arrives whether or not anything happened, so the reader learns to delete it
 * unopened and then deletes the one that mattered too.
 *
 * **It carries no link.** The original token is a SHA-256 digest in the
 * database and the plaintext was destroyed the moment the first email was
 * built, so this message genuinely cannot reproduce it. That is a property
 * worth keeping rather than a limitation to work around: a reminder that
 * minted a fresh token would hand out a second key every time it ran.
 *
 * So it points at the first email instead, and names the office as the way out
 * if that email is gone. Somebody who has lost the invitation needs a person,
 * not another automated message.
 */
class InvitationExpiringNotification extends KangaruNotification
{
    public function __construct(private readonly Invitation $invitation) {}

    public function type(): NotificationType
    {
        return NotificationType::ACCOUNT_INVITATION_EXPIRING;
    }

    public function subject(): string
    {
        return __('mail.invitation_expiring.subject');
    }

    public function body(): string
    {
        return __('mail.invitation_expiring.body');
    }

    public function url(): ?string
    {
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return ['invitation_id' => $this->invitation->id];
    }

    public function mailContent(): MailContent
    {
        return new MailContent(
            subject: $this->subject(),
            heading: __('mail.invitation_expiring.heading'),
            paragraphs: [
                __('mail.invitation_expiring.body'),
                __('mail.invitation_expiring.lost'),
            ],
            facts: [
                __('mail.invitation_expiring.fact_expires') => $this->invitation->expires_at->isoFormat('D MMMM YYYY, HH:mm'),
            ],
        );
    }
}
