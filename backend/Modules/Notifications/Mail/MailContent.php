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
     * @param  string  $subject   The inbox line. Under 45 characters, says what happened.
     * @param  string  $heading   The first line in the body. Usually not the subject again.
     * @param  array<int, string>  $paragraphs  Sentences. Two is plenty, three is a document.
     * @param  array<string, string>  $facts  Label to value. Rendered as rows, never as prose.
     * @param  string|null  $actionLabel  The button. Null means there is nothing to do.
     * @param  string|null  $actionUrl  Absolute. The renderer refuses a relative one.
     * @param  string|null  $preheader  The grey line the inbox shows after the subject.
     * @param  string|null  $footnote  One line under the action. Not a place for reasoning.
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
}
