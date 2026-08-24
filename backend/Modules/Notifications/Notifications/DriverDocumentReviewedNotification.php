<?php

namespace Modules\Notifications\Notifications;

use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Models\DriverDocument;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * Tells a driver what the office decided about one of their documents
 * (ADR-0052).
 *
 * ## This reverses ADR-0033 §6, which refused it
 *
 * That section was explicit — *"a driver learns their document was verified or
 * rejected by opening the app"* — and its reasoning was consistency: adding
 * notification to one surface while settlements and ratings had none *"would
 * be an inconsistency rather than a feature"*.
 *
 * **That premise expired.** ADR-0044 gave the support answer a push, ADR-0043
 * gave account closure an email, and the inconsistency now runs the other way:
 * documents are the last office decision a driver can only discover by
 * checking. ADR-0052 records the reversal and the owner's decision behind it.
 *
 * ## Rejection is the case that justifies the feature
 *
 * A verification is pleasant news that could have waited. A **rejection**
 * cannot: an unverified licence a driver believes is fine is a driver who
 * thinks they are compliant and is not, and every day between the refusal and
 * their next glance at the app is a day the office's request goes unanswered.
 * That is why both outcomes notify, and why the rejection carries the reason.
 *
 * ## What is deliberately not in the payload
 *
 * **No file, no link to one, and no image.** ADR-0033 §5 keeps these bytes
 * behind an authenticated, policy-checked controller precisely so that
 * possession of a URL is never enough, and a push notification lands on a lock
 * screen. The message names the *type* — "Driving licence" — which is not a
 * secret, and stops there.
 *
 * **The rejection reason reaches the email and nothing else.** The office's
 * words may name a defect in somebody's identity document, and a push lands on
 * a lock screen that is read over a shoulder in traffic.
 *
 * That is why `body()` — which `ExpoPushChannel` and `TenantDatabaseChannel`
 * both render verbatim — never contains it, and why only `toMail()` adds it.
 * **`pushOptions()` cannot be used to soften the push instead**: the channel
 * composes `$shown + … + $options`, and PHP's `+` keeps the left operand's
 * keys, so a `body` supplied there is silently discarded. Its docblock says as
 * much — *"`title`, `body` and `data` are this channel's to decide"* — and the
 * safe design is therefore a `body()` that is already safe everywhere, rather
 * than an override that looks applied and is not.
 *
 * The reason is not in `context()` either, so it never becomes push `data`.
 * The app already has it: `/me/documents` returns `rejection_reason` on the
 * row, behind the driver's own token.
 */
class DriverDocumentReviewedNotification extends KangaruNotification
{
    private function __construct(
        private readonly int $documentId,
        private readonly string $typeLabel,
        private readonly bool $verified,
        private readonly ?string $reason,
    ) {}

    public static function for(DriverDocument $document): self
    {
        return new self(
            (int) $document->getKey(),
            $document->type->label(),
            $document->status === DriverDocumentStatus::VERIFIED,
            $document->rejection_reason,
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::DRIVER_DOCUMENT_REVIEWED;
    }

    /**
     * Names the document, because a driver may have sent several.
     *
     * "Your document was checked" would send somebody into the app to find out
     * which of six — a round trip the subject line can simply save them.
     */
    public function subject(): string
    {
        return $this->verified
            ? "{$this->typeLabel} verified"
            : "{$this->typeLabel} needs attention";
    }

    /**
     * One sentence, safe on a lock screen.
     *
     * Rendered verbatim by the push channel *and* the in-app row, so it is
     * written for the least private of the two. The rejection reason is added
     * by `toMail()` alone — see the class notes.
     */
    public function body(): string
    {
        return $this->verified
            ? 'The office has accepted it. Nothing more to do.'
            : 'Open the app to see what the office asked for.';
    }

    /**
     * The email, and the one channel that carries the office's actual words.
     *
     * A driver reading this in their inbox is not holding the app, so sending
     * them to it without saying why would be a round trip for one sentence
     * they could have had here. That is the whole argument for the reason
     * being mandatory in the first place: "Rejected" with nothing after it is
     * how somebody stops using a feature (ADR-0032 §3 reached the same
     * conclusion about a declined settlement).
     *
     * `KangaruNotification::mailContent()` builds the subject and the body;
     * this adds the one extra line and nothing more. There is no action
     * button, because `url()` is null and there is no staff-console page to
     * send a driver to. Deliberately plain: no summary of the document, no
     * restatement of the subject, and no closing paragraph about how much the
     * office values them.
     *
     * Ported from `toMail()` when the mail channel moved onto the settings
     * mailer. Same words, same order, and the same reason for the order.
     */
    public function mailContent(): MailContent
    {
        $content = parent::mailContent();

        if ($this->verified || $this->reason === null || $this->reason === '') {
            return $content;
        }

        // Ahead of the body line rather than after it: the reason is the
        // message, and "open the app" is the instruction that follows from it.
        return new MailContent(
            subject: $content->subject,
            heading: $content->heading,
            paragraphs: [$this->reason, ...$content->paragraphs],
        );
    }

    /**
     * Null, like every driver-facing notification here.
     *
     * `url()` is a path into the staff SPA and the recipient is holding a
     * handset. The app routes from `context()` instead.
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
        return [
            'driver_document_id' => $this->documentId,
            'type_label' => $this->typeLabel,
            // A boolean rather than the status string, so the app branches on
            // data it cannot mis-spell. AGENTS.md's rule about branching on a
            // `code` rather than on prose, applied to a notification.
            'verified' => $this->verified,
        ];
    }
}
