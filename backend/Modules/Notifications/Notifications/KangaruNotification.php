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
     * How this message should be *delivered* by push, as opposed to what it
     * says (ADR-0046 §2).
     *
     * Empty for almost everything, and that is the intended answer: a
     * notification with nothing to add here gets Expo's defaults, which is a
     * quiet entry in the shade. Overriding it is a claim that this particular
     * message earns an interruption, which AGENTS.md asks for an argument for
     * rather than a use case.
     *
     * ## Why this lives on the notification and not in the channel
     *
     * `ExpoPushChannel` deliberately knows nothing about dispatch, bookings or
     * trips — it is a transport, and its docblock argues that keeping it that
     * way is what makes going direct to FCM and APNs a second implementation
     * rather than a rewrite. A `match` on notification type inside it would
     * put dispatch's ringtone, dispatch's expiry and dispatch's Android
     * channel id into the one class that must stay ignorant of them.
     *
     * ## The keys that are honoured
     *
     * Whatever Expo's push API accepts, merged over the ticket. In practice:
     * `channelId` (Android — which notification channel, and therefore which
     * sound and importance), `sound`, `priority`, `ttl`, `categoryId`,
     * `interruptionLevel` (iOS), `collapseId`, `_contentAvailable`.
     *
     * **`ttl` is the one worth naming.** Expo's default keeps a message
     * deliverable long after the thing it describes has gone, so a push held
     * by FCM while a handset was in a dead zone arrives later and rings for a
     * job that expired. Anything with a clock on it should set it.
     *
     * @return array<string, mixed>
     */
    public function pushOptions(): array
    {
        return [];
    }

    /**
     * Whether this push should reach the app without showing anything
     * (ADR-0046 §4).
     *
     * False for everything except a withdrawal, and it should stay that way:
     * a silent push is a message that spends a driver's battery and their
     * data to say something they are never told, so it has to be earning its
     * place by *acting* rather than by informing.
     *
     * When true, `ExpoPushChannel` sends `data` with no title and no body,
     * which is what makes the delivery silent — Expo decides on the presence
     * of those fields, not on a flag.
     *
     * **It is not reliable when the app has been killed**, and must never be
     * the only path to anything. Android does not hand a data-only message to
     * a terminated process (expo/expo#38223), so this is a message to a
     * *running* app. That is exactly the case a withdrawal needs — the app is
     * running, because it is ringing — and it is why nothing may depend on it.
     */
    public function pushIsSilent(): bool
    {
        return false;
    }

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
