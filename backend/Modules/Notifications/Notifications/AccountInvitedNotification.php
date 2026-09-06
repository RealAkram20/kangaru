<?php

namespace Modules\Notifications\Notifications;

use App\Enums\AccessLevel;
use App\Models\User;
use Modules\Administration\Models\Invitation;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * "Your account is ready. Choose a password."
 *
 * The first email this platform ever sends most of its users, and the one it
 * cannot afford to get wrong. Three things follow from that.
 *
 * **It says who created the account.** A stranger asking you to set a password
 * on a service you have never heard of is a phishing email. A message saying
 * *Shanitah General Enterprises created an account for you at Nakumatt Ltd*
 * is a message somebody can check with a colleague. The fact block carries the
 * company and the address the account signs in as for the same reason.
 *
 * **It carries no password.** Not a temporary one, not a generated one. The
 * same line `Modules/Administration` draws for staff and ADR-0018 draws for a
 * walk-in customer: nobody but the account holder ever knows the credential.
 *
 * **The token is in the URL and nowhere else.** Not in `context()`, which
 * becomes a stored row and push `data` for every other type in this enum. A
 * live credential for somebody's account has no business in either, and
 * `ApplicationDocumentRejectedNotification` reached the same conclusion about
 * its claim ticket.
 */
class AccountInvitedNotification extends KangaruNotification
{
    public function __construct(
        private readonly Invitation $invitation,
        private readonly string $token,
        private readonly ?User $invitedBy = null,
    ) {}

    public function type(): NotificationType
    {
        return NotificationType::ACCOUNT_INVITED;
    }

    public function subject(): string
    {
        return __('mail.invited.subject', ['app' => $this->appName()]);
    }

    public function body(): string
    {
        return __('mail.invited.body');
    }

    /**
     * Null. The accept page is reached by the token in `mailContent()`, and a
     * relative path here would become an action button pointing at the
     * console, which is not where this person is going.
     */
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
        return ['invitation_id' => $this->invitation->id];
    }

    public function mailContent(): MailContent
    {
        $user = $this->invitation->user;

        return new MailContent(
            subject: $this->subject(),
            heading: __('mail.invited.heading'),
            paragraphs: array_values(array_filter([
                $this->openingLine(),
                __('mail.invited.body'),
            ])),
            facts: array_filter([
                __('mail.invited.fact_company') => $this->organisationName(),
                __('mail.invited.fact_email') => (string) ($user->email ?? ''),
                __('mail.invited.fact_expires') => $this->invitation->expires_at->isoFormat('D MMMM YYYY'),
            ]),
            actionLabel: __('mail.invited.action'),
            actionUrl: $this->acceptUrl(),
            footnote: __('mail.invited.footnote'),
        );
    }

    /**
     * Who created the account, named where the platform knows.
     *
     * Falls back to a sentence with no name rather than to a guess. "Somebody
     * created an account for you" is weaker than naming the colleague, but it
     * is honest, and inventing an inviter would be worse than both.
     */
    private function openingLine(): string
    {
        $organisation = $this->organisationName();

        if ($this->invitedBy !== null) {
            return __('mail.invited.opening_by', [
                'inviter' => $this->invitedBy->name,
                'app' => $this->appName(),
                'company' => $organisation,
            ]);
        }

        return __('mail.invited.opening', [
            'app' => $this->appName(),
            'company' => $organisation,
        ]);
    }

    /**
     * The organisation this account belongs to.
     *
     * A client's tenant, a fleet's operator, and the platform's own name for
     * head office. Read from the recipient's own row rather than from the
     * inviter's: head office onboarding a client must not send that client an
     * email naming Kangaru as their employer.
     */
    private function organisationName(): string
    {
        $user = $this->invitation->user;

        if ($user === null) {
            return $this->appName();
        }

        return match ($user->access_level) {
            AccessLevel::CLIENT => (string) ($user->tenant->name ?? $this->appName()),
            AccessLevel::FLEET => (string) ($user->operator->name ?? $this->appName()),
            default => $this->appName(),
        };
    }

    private function acceptUrl(): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/invite/'.$this->token;
    }
}
