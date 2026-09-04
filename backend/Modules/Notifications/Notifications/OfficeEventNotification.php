<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * The office families (mail plan M6): a fleet's queues, and head office's.
 *
 * ## What an office alert is for, and what it is not
 *
 * It is a **queue**, not an interruption. Somebody has asked the office for
 * something and is waiting; the email exists so that waiting has a bound when
 * nobody happens to be looking at the board.
 *
 * That is why every one of these has an action pointing at the screen where
 * the work is done, and why none of them tries to summarise the decision. A
 * dispatcher does not answer a settlement request from their inbox, and an
 * email that pretended they could would be inviting a judgement made without
 * the record in front of them.
 *
 * ## Names, not details
 *
 * The subject names who and what. The body does not carry the driver's reason,
 * the passenger's phone number or the amount in dispute — those are on the
 * screen, behind the permission that lets somebody act on them.
 *
 * An office inbox is read on a shared machine at a depot desk, and ADR-0024 §7
 * already refuses to put a passenger's contact details anywhere they are not
 * needed. The same reasoning covers a queue email: it needs to say there is
 * something to do and where, and nothing beyond that earns the risk.
 */
class OfficeEventNotification extends KangaruNotification
{
    /**
     * @param  array<string, string>  $facts
     * @param  array<string, string>  $replacements  Placeholders for the lang strings.
     */
    public function __construct(
        private readonly NotificationType $event,
        private readonly array $facts = [],
        private readonly ?string $url = null,
        private readonly array $replacements = [],
    ) {}

    public function type(): NotificationType
    {
        return $this->event;
    }

    public function subject(): string
    {
        return __($this->key('subject'), $this->replacements);
    }

    public function body(): string
    {
        return __($this->key('body'), $this->replacements);
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
        return ['event' => $this->event->value];
    }

    public function mailContent(): MailContent
    {
        $absolute = $this->url === null
            ? null
            : rtrim((string) config('app.frontend_url'), '/').$this->url;

        return new MailContent(
            subject: $this->subject(),
            heading: __($this->key('heading'), $this->replacements),
            paragraphs: [__($this->key('body'), $this->replacements)],
            facts: $this->facts,
            actionLabel: $absolute === null ? null : (string) __($this->key('action')),
            actionUrl: $absolute,
        );
    }

    private function key(string $part): string
    {
        return 'mail.office.'.str_replace('.', '_', $this->event->value).'.'.$part;
    }
}
