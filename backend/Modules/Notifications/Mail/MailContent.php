<?php

namespace Modules\Notifications\Mail;

/**
 * What one email says, before anything decides how it looks.
 *
 * ## Why a value object and not a blade view per notification
 *
 * Sixty emails times two renderings (HTML and plain text) is a hundred and
 * twenty files, most of which differ only in their sentences. Worse, each one
 * would be a place where somebody could put a raw hex, a second button, or a
 * paragraph explaining the product. The shape is the constraint: **one
 * heading, a few sentences, an optional block of facts, at most one action.**
 * A notification that cannot say what it means inside that shape is a
 * notification that is trying to be two emails.
 *
 * The one-action rule is not a style preference. An email with two buttons
 * makes the reader choose before they have understood, and the second button
 * is almost always something that could have waited for the screen.
 *
 * ## Everything here is already translated
 *
 * Callers pass finished strings, resolved through `lang/en/mail.php`. The
 * renderer does no interpolation and no concatenation, which is what keeps
 * PRODUCT.md's "i18n-safe, no concatenated user-facing strings" true of the
 * mail system rather than only of the screens.
 */
final class MailContent
{
    /**
     * @param  string  $subject  The inbox line. Under 45 characters, says what happened.
     * @param  string  $heading  The first line in the body. Usually not the subject again.
     * @param  array<int, string>  $paragraphs  Sentences. Two is plenty, three is a document.
     * @param  array<string, string>  $facts  Label to value. Rendered as rows, never as prose.
     * @param  string|null  $actionLabel  The button. Null means there is nothing to do.
     * @param  string|null  $actionUrl  Absolute. The renderer refuses a relative one.
     * @param  string|null  $preheader  The grey line the inbox shows after the subject.
     * @param  string|null  $footnote  One line under the action. Not a place for reasoning.
     * @param  array<int, array{name: string, base64: string, mime: string}>  $attachments  See below.
     */
    public function __construct(
        public readonly string $subject,
        public readonly string $heading,
        public readonly array $paragraphs = [],
        public readonly array $facts = [],
        public readonly ?string $actionLabel = null,
        public readonly ?string $actionUrl = null,
        public readonly ?string $preheader = null,
        public readonly ?string $footnote = null,
        public readonly array $attachments = [],
    ) {}

    /**
     * The preheader, falling back to the first sentence.
     *
     * Written rather than left to chance, because an unset preheader does not
     * render as nothing: the inbox takes whatever text comes first in the
     * document, which for a templated email is the alt text of the logo. A
     * list of messages all previewing "KangaruRide" tells the reader nothing.
     */
    public function preheaderLine(): string
    {
        return $this->preheader ?? ($this->paragraphs[0] ?? $this->heading);
    }

    public function hasAction(): bool
    {
        return $this->actionLabel !== null && $this->actionUrl !== null;
    }

    /**
     * Base64, in memory, not raw bytes and not a path.
     *
     * ## Not a path
     *
     * A path would be the smaller change and the wrong one. These are queued
     * jobs: the worker that sends the email is a different process from the
     * one that built it, possibly minutes later, and a temporary file is
     * exactly the thing that is gone by then.
     *
     * ## Not raw bytes either, and this was found by running it
     *
     * A queued notification is serialised with `json_encode`, which refuses
     * anything that is not valid UTF-8. A PDF is not, so the first version of
     * this threw `InvalidPayloadException: Malformed UTF-8 characters` the
     * moment a real invoice was attached — **and it threw inside
     * `InvoiceService`, which would have taken the invoice down with it.**
     *
     * Base64 makes the payload JSON-safe by construction rather than by
     * everybody remembering. The channel decodes at send time.
     *
     * ## The cost, which is the reason to attach almost nothing
     *
     * Base64 is a third larger than the bytes it carries, and all of it counts
     * against the job payload and against whatever the recipient's mail server
     * will accept. A link is smaller, revocable and auditable. The invoice PDF
     * is here because the owner asked for both and because finance staff
     * forward the file rather than the link; nothing else should follow it
     * without the same argument.
     */
    public function hasAttachments(): bool
    {
        return $this->attachments !== [];
    }
}
