<?php

namespace Modules\Notifications\Notifications;

use App\Models\User;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

/**
 * The client family (mail plan M5): invoices, credit notes and contracts.
 *
 * ## Two audiences inside one client, and the split is the whole point
 *
 * Operations mail — a booking decision, a driver assigned — goes to the
 * account that raised the booking. **Finance mail goes to
 * `operator_clients.billing_email`.**
 *
 * A transport officer who books cars and the person who pays the bill are
 * different people at a bank, and sending invoices to the first is how they go
 * unpaid: the officer has no purchase-order process and no reason to forward
 * something that looks like a receipt for a trip they already took.
 *
 * `sendTo` is how that is expressed. When the contract carries a billing
 * address, the notification is routed there and the recipient may have **no
 * account on this platform at all** — which is fine and is why
 * `SettingsMailChannel` accepts an `AnonymousNotifiable`. When it does not,
 * the caller falls back to the client's administrator, because an invoice
 * nobody receives is worse than one received by the wrong colleague.
 *
 * ## What the contract emails are for
 *
 * ADR-0060 §5: a fleet asking to serve a client is **the client's decision and
 * nobody else's**, not Kangaru's and not the incumbent fleet's. Until this
 * email existed, the `requested` row sat in a table waiting for a client who
 * had no way of knowing it was there.
 */
class ClientEventNotification extends KangaruNotification
{
    /**
     * @param  array<string, string>  $facts
     * @param  array<int, array{name: string, base64: string, mime: string}>  $attachments
     * @param  array<string, string>  $replacements  Placeholders for the lang strings, e.g. the fleet's name.
     */
    public function __construct(
        private readonly NotificationType $event,
        private readonly array $facts = [],
        private readonly ?string $url = null,
        private readonly array $attachments = [],
        private readonly ?string $sendTo = null,
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

    /** The billing address where one is set, and the account's otherwise. */
    public function mailTo(User $user): string
    {
        return $this->sendTo ?? (string) $user->email;
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
            attachments: $this->attachments,
        );
    }

    private function key(string $part): string
    {
        return 'mail.client.'.str_replace('.', '_', $this->event->value).'.'.$part;
    }
}
