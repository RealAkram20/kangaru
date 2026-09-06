<?php

namespace Modules\Notifications\Channels;

use App\Models\User;
use Illuminate\Notifications\Notification as LaravelNotification;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Modules\Notifications\Models\DeviceToken;
use Modules\Notifications\Notifications\KangaruNotification;

/**
 * Pushes to a handset through Expo's service (ADR-0025 §2).
 *
 * ## Why Expo, behind our own class
 *
 * The app is Expo, so its service fronts both stores with one token format
 * and no credential files to distribute. Going to FCM and APNs directly buys
 * delivery receipts and per-device analytics that nobody has asked for, at
 * the cost of credential management — so it is a second implementation for
 * the day somebody wants those, and `device_tokens.provider` already records
 * which kind of token a row holds.
 *
 * ## This must never throw
 *
 * `NotificationSender` runs channels inline for anything on the `sync`
 * connection, and a push is raised from inside the request that dispatches a
 * ride. An exception here would roll back a `DispatchOffer` — a passenger's
 * ride failing because a third-party HTTP call timed out.
 *
 * ADR-0025 §3 states the rule: push is best-effort and never the only path.
 * Everything it says is independently readable from `GET /me/offers`, which
 * the app polls anyway. So a failure here is logged and dropped, and the
 * driver finds out four seconds later instead of instantly.
 */
class ExpoPushChannel
{
    private const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

    public function send(object $notifiable, LaravelNotification $notification): void
    {
        if (! $notifiable instanceof User || ! $notification instanceof KangaruNotification) {
            return;
        }

        $tokens = DeviceToken::query()
            ->where('user_id', $notifiable->id)
            ->where('provider', 'expo')
            ->pluck('token')
            ->all();

        // A user with no registered device is the normal state of every staff
        // account in the platform, and of any driver who declined the OS
        // permission. ADR-0025 §3 requires the app to work for them, so this
        // is not an error and for almost every message it is not worth a word.
        //
        // **Except for the messages that say a passenger is waiting.** This
        // guard is where the whole offer-push feature silently ended: it
        // returned here on every one of the first thirty-eight offers this
        // platform dispatched, because `device_tokens` was empty for the entire
        // fleet, and nothing anywhere said so. The in-app row was still
        // written, so from every other angle push looked as though it had been
        // sent. Sentry reported nothing because nothing failed — the code was
        // never entered.
        //
        // The notification decides which case it is (`pushIsCritical()`), so
        // this class still knows nothing about dispatch or duty. `warning` is
        // deliberate and not arbitrary: `SENTRY_LOG_LEVEL` is `warning`, so
        // this is the lowest level that actually leaves the machine.
        if ($tokens === []) {
            if ($notification->pushIsCritical()) {
                Log::warning('push.no_device', [
                    'user_id' => $notifiable->id,
                    'type' => $notification->type()->value,
                ]);
            }

            return;
        }

        // How this message wants to be *delivered*, as opposed to what it
        // says. Empty for almost everything; a job offer asks for a ringtone
        // channel, an expiry and a collapse key. See
        // `KangaruNotification::pushOptions` for why that knowledge lives on
        // the notification and not in this class.
        //
        // Applied over the defaults, so a notification that has thought about
        // its own delivery wins — but under the envelope below, because `to`,
        // `title`, `body` and `data` are this channel's to decide and a
        // subclass silently redirecting a push to another handset is not a
        // capability worth leaving open.
        $options = $notification->pushOptions();

        // **A silent push carries no title and no body**, because that — not a
        // flag — is how Expo and the platforms below it decide whether to
        // show anything. Adding an empty string would render an empty
        // notification, which is worse than either outcome.
        $shown = $notification->pushIsSilent()
            ? []
            : [
                'title' => $notification->subject(),
                'body' => $notification->body(),
            ];

        $message = $shown + [
            // The ids behind the sentence, so the app can open
            // the right screen on a tap without parsing prose —
            // the same reason `context()` exists for the in-app
            // row, and the same reason AGENTS.md has clients
            // branch on an error `code`.
            //
            // Never the passenger's name or number: ADR-0025 §5.
            // A lock screen is readable by whoever is holding the
            // phone, and those are released only after an accept.
            'data' => $notification->context(),
        ] + $options + [
            // Rings and vibrates. Reserved for the types
            // ADR-0025 §5 argues for — a job offer with a
            // countdown on it is the only reason this app is
            // installed.
            'priority' => 'high',
            'sound' => 'default',
        ];

        /*
         * **The invisible twin that wakes the app** (see
         * `KangaruNotification::pushWakeOptions`).
         *
         * No title and no body, because that — not a flag — is what makes a
         * push headless, and headless is the only shape Android hands to the
         * app's JavaScript when the driver is not looking at the screen. The
         * `data` is identical, so the app reads the offer out of either one
         * with the same code.
         *
         * Null for almost every notification on the platform, and null is the
         * cheap path: nothing extra is built and nothing extra is sent.
         */
        $wakeOptions = $notification->pushWakeOptions();

        $wake = $wakeOptions === null
            ? null
            : ['data' => $notification->context()] + $wakeOptions + [
                'priority' => 'high',
                // iOS: the flag that makes APNs deliver a payload with nothing
                // to show. Without it a body-less push is simply dropped.
                '_contentAvailable' => true,
            ];

        /*
         * **Both messages, and the token behind each of them.**
         *
         * Expo returns receipts *positionally*, so `pruneDeadTokens` has always
         * matched them against `$tokens` by index. The moment a second message
         * per handset was added that stopped being true — index 3 of the
         * receipts is no longer index 3 of the fleet — and the consequence is
         * not a missing log line: it is **deleting the wrong driver's device
         * token** on a `DeviceNotRegistered`, which silently stops that driver
         * receiving jobs.
         *
         * So the parallel list is built here rather than derived later.
         *
         * The visible message goes first, deliberately. It is the one that
         * rings, and a driver should hear the job at the earliest possible
         * moment rather than after a round trip through the app.
         */
        $envelopes = [];
        $envelopeTokens = [];

        foreach ($tokens as $token) {
            $envelopes[] = ['to' => $token] + $message;
            $envelopeTokens[] = $token;
        }

        if ($wake !== null) {
            foreach ($tokens as $token) {
                $envelopes[] = ['to' => $token] + $wake;
                $envelopeTokens[] = $token;
            }
        }

        try {
            // **Three seconds, cut from five, because this now runs inline.**
            //
            // `TripOfferedNotification::viaConnections()` puts the offer push on
            // the `sync` connection so a 45-second countdown does not wait on a
            // queue worker — which means this timeout is no longer a worker's
            // problem, it is the ceiling this class adds to the HTTP request
            // that dispatched the ride. AGENTS.md gives nothing over three
            // seconds a right to block a request; this is that number, applied
            // to the one call that inherited the obligation.
            //
            // What is lost on a timeout is the *acceleration*, not the offer:
            // the catch below logs it, the in-app row is already written, and
            // `GET /me/offers` still has the job. ADR-0025 §3.
            $response = Http::timeout(3)
                ->acceptJson()
                ->post(self::ENDPOINT, $envelopes);

            $this->pruneDeadTokens($response->json('data') ?? [], $envelopeTokens);
        } catch (\Throwable $e) {
            Log::warning('push.send_failed', [
                'user_id' => $notifiable->id,
                'type' => $notification->type()->value,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Deletes tokens Expo says are dead, and says so about every other error.
     *
     * A `DeviceNotRegistered` receipt means the app was uninstalled or the
     * token was reissued. Left in place, that row fails on every send
     * forever — and, worse, makes `last_seen_at` monitoring useless, because
     * a driver would appear to have a device when they do not.
     *
     * **Every other error ticket is logged, and this line is paid for.** The
     * HTTP call to Expo returns 200 whether or not anything can be delivered;
     * the failure arrives inside the ticket. For weeks every push on the
     * platform died with `InvalidCredentials` — no FCM service key on EAS —
     * and nothing anywhere said so, because this method read the receipts
     * and reacted only to the one error it knew. The same silence as the
     * empty-token guard above, one layer further in. `warning`, because
     * `SENTRY_LOG_LEVEL` is `warning` and a log below it never leaves the
     * machine. Once per send, not per token: a fleet of dead credentials is
     * one fact, not a hundred.
     *
     * Receipts come back positionally, in the order the tickets were sent.
     *
     * **`$sentTo` is one entry per *message*, not per handset**, and it is
     * named for that rather than called `$tokens`. A handset can receive two
     * messages for one notification — the visible push and the invisible one
     * that wakes the app — so the same token legitimately appears twice, and
     * an index into this list is an index into the tickets, never into the
     * fleet. Getting that wrong deletes a different driver's device token.
     *
     * @param  array<int, mixed>  $receipts
     * @param  array<int, string>  $sentTo
     */
    private function pruneDeadTokens(array $receipts, array $sentTo): void
    {
        $dead = [];
        $failed = [];

        foreach (array_values($receipts) as $index => $receipt) {
            if (! is_array($receipt) || ($receipt['status'] ?? null) !== 'error') {
                continue;
            }

            $error = $receipt['details']['error'] ?? 'unknown';

            if ($error === 'DeviceNotRegistered' && isset($sentTo[$index])) {
                $dead[] = $sentTo[$index];

                continue;
            }

            $failed[$error] = ($failed[$error] ?? 0) + 1;
        }

        if ($dead !== []) {
            DeviceToken::query()->whereIn('token', $dead)->delete();
        }

        foreach ($failed as $error => $count) {
            Log::warning('push.ticket_error', ['error' => $error, 'count' => $count]);
        }
    }
}
