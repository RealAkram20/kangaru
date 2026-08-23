<?php

namespace Modules\Notifications\Notifications;

use App\Models\User;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * "Something changed about how your account is reached."
 *
 * One class for the whole security family (mail plan M3) rather than nine
 * near-identical ones. They differ only in a key and a fact block: every one of
 * them is required, every one is mail plus the in-app row, and every one exists
 * for the same reason, which is that **the person who did it is not always the
 * person who owns the account.**
 *
 * That is the whole design. A password change, an MFA removal, a payout account
 * edit and an address change are each a legitimate action a user takes and each
 * the first move of somebody who has taken an account. The email is not a
 * receipt for the person who clicked; it is a tripwire for the person who did
 * not.
 *
 * ## Why the type is still per event
 *
 * A single `account.security` type would have been less code and worse. The
 * `NotificationType` value doubles as AGENTS.md's structured business-event
 * name and as the `notifications.type` column, so collapsing nine events into
 * one string would make the log unable to say which of them happened, and would
 * make a preference for one a preference for all. Cases are one line each; the
 * class is what gets shared.
 *
 * ## What none of these carry
 *
 * A link to undo anything, and any part of the credential that changed. No
 * password, no code, no account number, not even a masked one. An email that
 * quotes the thing it is warning you about hands it to whoever is reading the
 * mailbox, which in the case this exists for is the attacker.
 */
class SecurityEventNotification extends KangaruNotification
{
    /**
     * @param  array<string, string>  $facts  Already formatted and already safe to print.
     * @param  string|null  $sendTo  Overrides the recipient address. See `mailTo()`.
     */
    public function __construct(
        private readonly NotificationType $event,
        private readonly array $facts = [],
        private readonly ?string $sendTo = null,
    ) {}

    public function type(): NotificationType
    {
        return $this->event;
    }

    public function subject(): string
    {
        return __($this->key('subject'));
    }

    public function body(): string
    {
        return __($this->key('body'));
    }

    /**
     * Null for all of them.
     *
     * There is deliberately nothing to click. Every action here is already
     * done, and the honest next step is either "you did this, ignore it" or
     * "you did not, call the office" — neither of which is a URL. A button
     * offering to undo a change would also be the single most valuable thing
     * to forge, because it is a link in a security email that people are
     * primed to click.
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
        return ['event' => $this->event->value];
    }

    /**
     * Where this one goes, which is not always the account's current address.
     *
     * `ACCOUNT_EMAIL_CHANGED` is sent twice, and the second copy goes to the
     * address the account **used to** have. Somebody who has taken an account
     * and changed its address would otherwise have silenced the one warning
     * that would reach the real owner, by sending it to themselves.
     */
    public function mailTo(User $user): string
    {
        return $this->sendTo ?? (string) $user->email;
    }

    public function mailContent(): MailContent
    {
        return new MailContent(
            subject: $this->subject(),
            heading: __($this->key('heading')),
            paragraphs: array_values(array_filter([
                __($this->key('body')),
                __('mail.security.not_you'),
            ])),
            facts: $this->facts,
        );
    }

    private function key(string $part): string
    {
        // "account.password_changed" becomes "mail.security.account_password_changed.subject".
        return 'mail.security.'.str_replace('.', '_', $this->event->value).'.'.$part;
    }
}
