<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * The driver family (mail plan M4): applications, documents, settlements,
 * contracts and the weekly bonus.
 *
 * One class and a `NotificationType` case each, on the same argument
 * `SecurityEventNotification` makes: they differ in a key, a fact block and a
 * destination, not in shape. What is shared is the part worth getting right
 * once.
 *
 * ## They are read on a handset, in the sun, often mid-shift
 *
 * PRODUCT.md's operating context is not decoration here. Every sentence is
 * written to be understood standing beside a car, so the subject says the
 * whole thing and the body says what to do about it. Where there is an amount
 * or a date it goes in the fact block, because a figure buried in a paragraph
 * is a figure somebody misreads.
 *
 * ## The office's words are carried where they exist and never invented
 *
 * A rejection reason, a refusal reason: passed in, printed verbatim, and
 * omitted entirely when the office did not give one. `DriverDocumentReviewedNotification`
 * already argues this at length and it holds here: "Declined" with nothing
 * after it is how somebody stops using a feature.
 */
class DriverEventNotification extends KangaruNotification
{
    /**
     * @param  array<string, string>  $facts  Already formatted and safe to print.
     * @param  string|null  $reason  The office's own words, or null when it gave none.
     * @param  string|null  $url  Where to go in the SPA, for the office-facing cases only.
     */
    public function __construct(
        private readonly NotificationType $event,
        private readonly array $facts = [],
        private readonly ?string $reason = null,
        private readonly ?string $url = null,
    ) {}

    public function type(): NotificationType
    {
        return $this->event;
    }

    public function subject(): string
    {
        return __($this->key('subject'));
    }

    /**
     * One sentence, and safe on a lock screen.
     *
     * Rendered verbatim by the push channel and the in-app row, so it is
     * written for the least private of the three. **The reason is never in
     * here** — `mailContent()` adds it, and only there. A push lands on a
     * screen that is read over a shoulder, and why somebody's settlement was
     * declined is nobody else's business.
     */
    public function body(): string
    {
        return __($this->key('body'));
    }

    public function url(): ?string
    {
        return $this->url;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        // No reason, for the same argument as `body()`: `context()` becomes
        // push `data` and a stored row, and neither is a place for the
        // office's account of somebody's shortcomings.
        return ['event' => $this->event->value];
    }

    public function mailContent(): MailContent
    {
        $paragraphs = [__($this->key('body'))];

        // Ahead of the instruction rather than after it: when there is a
        // reason, the reason is the message and "what to do next" follows from
        // it. Same ordering `DriverDocumentReviewedNotification` settled on.
        if ($this->reason !== null && trim($this->reason) !== '') {
            array_unshift($paragraphs, trim($this->reason));
        }

        $next = __($this->key('next'));

        // A missing `next` key resolves to the key itself in Laravel, which
        // would print "mail.driver.foo.next" into somebody's inbox. Checked
        // rather than assumed: not every event has a next step.
        if ($next !== $this->key('next')) {
            $paragraphs[] = $next;
        }

        return new MailContent(
            subject: $this->subject(),
            heading: __($this->key('heading')),
            paragraphs: $paragraphs,
            facts: $this->facts,
        );
    }

    private function key(string $part): string
    {
        return 'mail.driver.'.str_replace('.', '_', $this->event->value).'.'.$part;
    }
}
