<?php

namespace Modules\Notifications\Notifications;

use App\Models\Operator;
use App\Models\User;
use Modules\Fleet\Models\OwnershipTransfer;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * "You are becoming the owner of this fleet. Choose a password."
 *
 * Sent to an address that has **no account** — `Notification::route('mail')`,
 * the applicant path — so mail is its only channel by type. Like
 * `AccountInvitedNotification`, and for its reasons:
 *
 * - **it names who arranged it and which fleet**, because a stranger asking
 *   you to set a password is a phishing email and a named colleague and
 *   company are something the reader can check;
 * - **it carries no password** — the credential is chosen by the reader and
 *   known to nobody else;
 * - **the token is in the URL and nowhere else** — never in `context()`,
 *   which becomes stored rows.
 */
class FleetOwnershipInvitedNotification extends KangaruNotification
{
    public function __construct(
        private readonly OwnershipTransfer $transfer,
        private readonly Operator $operator,
        private readonly string $token,
        private readonly ?User $invitedBy = null,
    ) {}

    public function type(): NotificationType
    {
        return NotificationType::PLATFORM_FLEET_OWNERSHIP_INVITED;
    }

    public function subject(): string
    {
        return __('mail.ownership.subject', ['fleet' => (string) $this->operator->name]);
    }

    public function body(): string
    {
        return __('mail.ownership.body');
    }

    /** Null — the accept page is reached by the token in `mailContent()`,
     * and the reader has no console to be sent to. */
    public function url(): ?string
    {
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        // No token. See the class notes.
        return ['ownership_transfer_id' => $this->transfer->id];
    }

    public function mailContent(): MailContent
    {
        return new MailContent(
            subject: $this->subject(),
            heading: __('mail.ownership.heading', ['fleet' => (string) $this->operator->name]),
            paragraphs: array_values(array_filter([
                $this->invitedBy !== null
                    ? __('mail.ownership.opening_by', [
                        'inviter' => $this->invitedBy->name,
                        'app' => $this->appName(),
                        'fleet' => (string) $this->operator->name,
                    ])
                    : __('mail.ownership.opening', [
                        'app' => $this->appName(),
                        'fleet' => (string) $this->operator->name,
                    ]),
                __('mail.ownership.body'),
            ])),
            facts: array_filter([
                __('mail.ownership.fact_fleet') => (string) $this->operator->name,
                __('mail.ownership.fact_email') => $this->transfer->email,
                __('mail.ownership.fact_expires') => $this->transfer->expires_at->isoFormat('D MMMM YYYY'),
            ]),
            actionLabel: __('mail.ownership.action'),
            actionUrl: rtrim((string) config('app.frontend_url'), '/').'/owner/'.$this->token,
            footnote: __('mail.ownership.footnote'),
        );
    }
}
