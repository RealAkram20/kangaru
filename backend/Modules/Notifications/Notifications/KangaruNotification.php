<?php

namespace Modules\Notifications\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification as LaravelNotification;
use Modules\Notifications\Channels\TenantDatabaseChannel;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;

/**
 * What every KangaruRide notification has to answer.
 *
 * Subclasses supply four things — a headline, a sentence, somewhere to go
 * and a structured payload — and get the in-app row, the email and the
 * channel selection for free. Adding a notification is one small class,
 * which is what keeps AGENTS.md's "avoid notification fatigue" a decision
 * about the list rather than about the effort.
 *
 * ShouldQueue: AGENTS.md gives nothing over three seconds a right to block
 * a request, and sending mail crosses a network.
 *
 * But only the mail. `viaConnections()` below puts the in-app row on the
 * `sync` connection so it is written during the request that caused it —
 * otherwise approving a booking would leave the approver's own bell
 * unchanged until a worker happened to run, which reads as the click
 * having failed. That was observed, not theorised: the first end-to-end
 * run returned `unread: 0` after a successful approval and only produced
 * the row once `queue:work` was started.
 */
abstract class KangaruNotification extends LaravelNotification implements ShouldQueue
{
    use Queueable;

    /**
     * Per-channel queue connections.
     *
     * The in-app row is a local INSERT — queueing it buys nothing and costs
     * the immediacy the badge depends on. Mail crosses a network, so it
     * keeps the configured queue connection and a worker delivers it.
     *
     * @return array<string, string|null>
     */
    public function viaConnections(): array
    {
        return [
            TenantDatabaseChannel::class => 'sync',
        ];
    }

    /** Stable name, shared with the log line and `notifications.type`. */
    abstract public function type(): NotificationType;

    /** One line. Becomes the mail subject and the in-app headline. */
    abstract public function subject(): string;

    /** A sentence saying what happened and, where useful, what to do next. */
    abstract public function body(): string;

    /**
     * Where to go, relative to the SPA root — "/bookings/41". Null when
     * there is nowhere useful, which is better than a link to a list.
     */
    abstract public function url(): ?string;

    /**
     * Ids and figures behind the sentence, so a client can branch on data
     * rather than parse prose — the same reason AGENTS.md has clients
     * branch on an error `code` and never on its message.
     *
     * @return array<string, mixed>
     */
    abstract public function context(): array;

    /**
     * Channels for this type, from configuration.
     *
     * Config decides, the enum only supplies the fallback (AGENTS.md
     * Configuration Driven): which channel carries which message is an
     * operational call, and a deployment that wants booking decisions
     * in-app only should not need a release.
     *
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        $configured = config('notifications.channels.'.$this->type()->value);

        // array_values, not just array_filter: filter preserves keys, so
        // dropping an unrecognised channel from the middle of a configured
        // list would leave a gappy array rather than a list. That is not a
        // shape a `@return array<int, string>` promises, and it reaches
        // Laravel and the JSON encoder.
        $channels = is_array($configured)
            ? array_values(array_filter(array_map(
                fn (mixed $value) => is_string($value) ? NotificationChannel::tryFrom($value) : null,
                $configured,
            )))
            : $this->type()->defaultChannels();

        return array_map(fn (NotificationChannel $channel) => $channel->driver(), $channels);
    }

    public function toMail(object $notifiable): MailMessage
    {
        $mail = (new MailMessage)
            ->subject($this->subject())
            ->line($this->body());

        $url = $this->url();

        if ($url !== null) {
            // Absolute for mail: a relative path in an email client goes
            // nowhere. The SPA's own base URL, not the API's.
            $mail->action('Open in KangaruRide', rtrim((string) config('app.frontend_url'), '/').$url);
        }

        return $mail;
    }
}
