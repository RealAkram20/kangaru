<?php

namespace Modules\Notifications\Notifications;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification as LaravelNotification;
use Modules\Administration\Services\SettingsService;
use Modules\Notifications\Channels\TenantDatabaseChannel;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailContent;

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
     * Whether a push that reached nobody is worth telling the office about.
     *
     * False for everything except a job offer, and the default has to be false
     * because **a recipient with no registered device is the ordinary state of
     * this platform**: every staff account, every driver who declined the OS
     * permission, everyone who has never installed the app.
     * `ExpoPushChannel` says so at its own guard, and logging there
     * unconditionally would produce a warning per notification per office
     * worker, which is a stream nobody reads and therefore a stream that hides
     * the one line that matters.
     *
     * **The one line that matters is this, and it went unlogged for the whole
     * life of the feature.** A driver who is on duty, whose handset has no push
     * token, is a driver the matcher is about to offer a job to and who will
     * never hear it. That is not a quiet normality — it is a passenger on a
     * kerb. `device_tokens` was empty for the entire fleet and nothing anywhere
     * said so, because the only code that could have noticed was documented as
     * having nothing worth saying.
     *
     * ## Why the notification answers this and not the channel
     *
     * Same argument `pushOptions()` makes, and it is the one that keeps
     * `ExpoPushChannel` a transport: the channel must not learn what dispatch
     * is, what duty is, or which types have a passenger waiting at the end of
     * them. It asks the message *"does it matter that this went nowhere?"* and
     * the message — which knows what it is — answers.
     */
    public function pushIsCritical(): bool
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

    /**
     * What this notification's email says.
     *
     * The default is derived from the four things every notification already
     * answers, so a subclass that has nothing special to say gets a properly
     * branded email for free and adding a notification stays one small class.
     * That is the same argument the rest of this base makes: keep the cost of
     * a new type low so the decision stays about AGENTS.md's list rather than
     * about the effort.
     *
     * Override it when the email genuinely differs from the in-app row. The
     * two are not the same surface and pretending otherwise produces bad
     * versions of both. An in-app row is read *inside* the product, next to
     * the thing it describes, so it can be a fragment. An email arrives with
     * no context at all, days later, in a list of forty other messages, and
     * often on a phone. It usually needs a fact block; it never needs more
     * prose.
     *
     * The action label is deliberately generic here. A subclass that knows
     * what the reader is going to do should say so instead: "Upload it now"
     * beats "Open in KangaruRide" every time, and a button whose label
     * describes the destination rather than the task is a button people do not
     * press.
     */
    public function mailContent(): MailContent
    {
        $url = $this->url();

        return new MailContent(
            subject: $this->subject(),
            heading: $this->subject(),
            paragraphs: [$this->body()],
            // The brand name comes from settings, not from a constant. A
            // deployment that renamed itself in the settings screen renamed
            // itself everywhere, and a button that still says KangaruRide
            // would be the one place it did not take.
            actionLabel: $url === null ? null : __('mail.layout.open', ['app' => $this->appName()]),
            // Absolute for mail: a relative path in an email client goes
            // nowhere. The SPA's own base URL, not the API's.
            actionUrl: $url === null ? null : rtrim((string) config('app.frontend_url'), '/').$url,
        );
    }
    /**
     * The address this notification goes to.
     *
     * The recipient's own, for everything except the one type that must reach
     * an address the account no longer has. Overridden by
     * `SecurityEventNotification` for `ACCOUNT_EMAIL_CHANGED`, which is sent
     * twice: once to the new address and once to the old one, so an attacker
     * who changed the address cannot have silenced the warning by pointing it
     * at themselves.
     */
    public function mailTo(User $user): string
    {
        return (string) $user->email;
    }

    /**
     * The platform's name, from settings rather than from a constant.
     *
     * A deployment that renamed itself in the settings screen renamed itself
     * everywhere, and an email still saying KangaruRide would be the one place
     * it did not take. Resolved at send time, which is safe because these are
     * queued and the container is available.
     */
    protected function appName(): string
    {
        return (string) app(SettingsService::class)->get('branding', 'app_name');
    }
}
