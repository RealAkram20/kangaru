<?php

namespace Modules\Notifications\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Modules\Notifications\Enums\NotificationType;

/**
 * Asks an applicant to send one document again (ADR-0057 §3).
 *
 * ## Why this is not `DriverDocumentReviewedNotification`
 *
 * That one tells a *driver* what the office decided, through the database and
 * push channels their account and their registered handset make available. An
 * applicant has an account since ADR-0057 §5, but no device registered to it
 * and no `notifications` row to write against, so the recipient here is an
 * email address on a `driver_applications` row, reached with
 * `Notification::route('mail', ...)`.
 *
 * It is also a different message. A driver learning their licence was refused
 * already has the app open and the upload button in front of them; an
 * applicant has closed it and may never have signed in. So this one has to
 * **say how to get back in** — which since §5 is "sign in", and carries
 * nothing.
 *
 * **The `resendUrl` branch is the older path and still needed.**
 * `RootNavigator` drops the claim ticket the moment the KYC screen exits,
 * deliberately, because that screen refuses to persist *"a live credential
 * for somebody's identity documents"* on a handset. An applicant with no
 * account has nothing else, so they get a fresh one by email.
 *
 * ## What it says, and the one thing it does not
 *
 * The document type and the office's reason — and, only for an applicant with
 * no account, a link carrying a fresh claim ticket. The reason is included
 * here where
 * `DriverDocumentReviewedNotification` keeps it out of `body()` — that
 * restraint exists because its body is rendered verbatim onto a lock screen
 * by the push channel, and this notification has no push channel to protect.
 * An email the applicant opens is the private surface that one was avoiding.
 *
 * **No file, no thumbnail, no link to one.** ADR-0033 §5 keeps document bytes
 * behind an authenticated, policy-checked controller precisely so possession
 * of a URL is never enough.
 */
class ApplicationDocumentRejectedNotification extends KangaruNotification
{
    private function __construct(
        private readonly string $typeLabel,
        private readonly string $reason,
        /**
         * A claim ticket link, for an applicant who has no account.
         *
         * Null is the ordinary case since ADR-0057 §5: the applicant signs
         * in. It is non-null only for the ones who were never given an
         * account — a duplicate email, which ADR-0027 §5 requires to be
         * indistinguishable at submission, and everybody who applied before
         * accounts moved to submission time.
         */
        private readonly ?string $resendUrl,
    ) {}

    public static function for(string $typeLabel, string $reason, ?string $resendUrl = null): self
    {
        return new self($typeLabel, $reason, $resendUrl);
    }

    public function type(): NotificationType
    {
        return NotificationType::DRIVER_APPLICATION_DOCUMENT_REJECTED;
    }

    public function subject(): string
    {
        return 'Please send your '.mb_strtolower($this->typeLabel).' again';
    }

    /**
     * Names the document and says the rest is untouched.
     *
     * The second sentence is doing real work. An applicant told a document was
     * refused reasonably fears the whole application went with it — that was
     * the only outcome available before ADR-0057 — and one who believes they
     * have been turned down does not send a replacement.
     */
    public function body(): string
    {
        return sprintf(
            'Your %s could not be accepted: %s. Your application is still open and '
            .'everything else you sent has been kept — you only need to send this one again.',
            mb_strtolower($this->typeLabel),
            rtrim($this->reason, '.'),
        );
    }

    /**
     * Null, and overridden below.
     *
     * `KangaruNotification::toMail()` builds an action button by joining this
     * to the SPA's base URL, and the applicant is not going to the console.
     * Returning the resend link here would point them at a staff application.
     */
    public function url(): ?string
    {
        return null;
    }

    /** @return array<string, mixed> */
    public function context(): array
    {
        // The ticket is deliberately absent. `context()` becomes push `data`
        // and a stored notification row for every other type in this enum, and
        // a claim ticket is a credential rather than a fact about the event.
        return ['type_label' => $this->typeLabel];
    }

    /**
     * **No credential in the email, in the ordinary case.**
     *
     * The first version of this always carried a claim ticket — a live
     * credential for somebody's identity documents, sitting in an inbox for
     * as long as inboxes last. Since ADR-0057 §5 the applicant has an
     * account, so the email can say "sign in" and carry nothing at all,
     * which is strictly better: an intercepted message is then worth no more
     * than knowing a document was refused.
     *
     * The ticket branch remains for the applicants who have no account, and
     * only they see a link.
     */
    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject($this->subject())
            ->line($this->body());

        if ($this->resendUrl === null) {
            return $mail->line(
                'Open the KangaruRide driver app and sign in with the email and password you '
                .'used to apply. Your documents are on the first screen.'
            );
        }

        return $mail
            ->action('Send it again', $this->resendUrl)
            ->line('This link works for the next 24 hours. If it expires, the office will call you.');
    }
}
