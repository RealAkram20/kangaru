<?php

namespace Modules\Notifications\Channels;

use App\Models\User;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Notifications\Notification as LaravelNotification;
use Illuminate\Support\Facades\Log;
use Modules\Administration\Services\SettingsService;
use Modules\Notifications\Mail\MailAudience;
use Modules\Notifications\Mail\MailRenderer;
use Modules\Notifications\Models\MailDelivery;
use Modules\Notifications\Models\MailPreference;
use Modules\Notifications\Models\MailToggle;
use Modules\Notifications\Notifications\KangaruNotification;
use Throwable;

/**
 * Sends a notification by email, through the SMTP details the owner saved.
 *
 * ## Why this replaces Laravel's `mail` channel
 *
 * `NotificationChannel::MAIL` used to resolve to the string `mail`, which is
 * the framework's default mailer, which is `MAIL_MAILER` from `.env`, which
 * is `log`. Booking approved, booking rejected and driver document reviewed
 * were therefore written to `storage/logs/laravel.log` for the whole life of
 * those features, while `PasswordResetService` sent real mail down a
 * completely separate path built from settings.
 *
 * Two paths meant the settings screen's test send could pass green while
 * every booking email went to a log file. **One path is the entire point:** a
 * successful test send now vouches for the path that matters, because it is
 * the same path.
 *
 * ## Four gates, and each one is silence rather than an error
 *
 * A notification is raised by something else finishing — approving a booking,
 * verifying a licence. None of those may fail because email is switched off,
 * misconfigured, or unwanted. So each gate returns, and the in-app row written
 * by `TenantDatabaseChannel` is what the recipient still gets.
 *
 * 1. **No address.** An account can exist without a usable one.
 * 2. **Mail not configured.** `mailConfigured()` is the single switch, the
 *    same one `PasswordResetService::enabled()` reads before offering the
 *    reset flow at all.
 * 3. **The platform switched this type off.** `MailToggle`, set by a system
 *    administrator in the settings screen, for everyone at once.
 * 4. **This recipient asked us to stop.** `MailPreference`, set by the person
 *    themselves, for themselves only.
 *
 * Three and four are deliberately two different switches rather than one with
 * a scope column. A platform toggle stored per user would have to be written
 * across every account and rewritten for every new one; a per-user preference
 * read as a platform default would let one dispatcher's choice decide what a
 * colleague receives. Required types ignore both, decided by
 * `NotificationType::mailIsRequired()` at send time so neither a stale row nor
 * an administrator can silence a password reset.
 *
 * ## The delivery row is written before the transport is touched
 *
 * Not after. A worker killed mid-send then leaves a `queued` row, so the gap
 * is visible. Writing it on success instead would make every crash look like
 * an email that was never attempted, which is the one thing a support person
 * must be able to rule out.
 */
class SettingsMailChannel
{
    /**
     * Consecutive failures before the platform says the transport is down.
     *
     * One failure is a bad address. Three is an outage, and only one of those
     * is worth an alert.
     */
    private const OUTAGE_THRESHOLD = 3;

    public function __construct(
        private readonly SettingsService $settings,
        private readonly MailRenderer $renderer,
    ) {}

    public function send(object $notifiable, LaravelNotification $notification): void
    {
        if (! $notification instanceof KangaruNotification) {
            return;
        }

        /*
         * Two kinds of recipient, and the second one nearly got lost.
         *
         * Most notifications go to a `User`. But an **applicant** has no
         * account until they are approved, so `ApplicationDocumentReviewController`
         * reaches them with `Notification::route('mail', $email)`, which
         * produces an `AnonymousNotifiable` and not a `User`.
         *
         * The first version of this channel returned early for anything that
         * was not a `User`. That silently dropped every email to somebody who
         * had applied and not yet been approved — the exact population that
         * has no other way of hearing anything, because they have no inbox to
         * check and no app to open. It passed every test in the suite, because
         * the tests covered notifications to accounts.
         */
        $user = $notifiable instanceof User ? $notifiable : null;

        // Narrowed rather than duck-typed. `send()` takes `object` because
        // that is Laravel's channel contract, but only two shapes ever reach
        // it: a `User`, or the `AnonymousNotifiable` that
        // `Notification::route()` produces. Anything else is a caller mistake
        // and is dropped rather than guessed at.
        if ($user === null && ! $notifiable instanceof AnonymousNotifiable) {
            return;
        }

        // Asked of the notification rather than read off the user, because
        // one type deliberately does not go to the account's current address:
        // `ACCOUNT_EMAIL_CHANGED` is sent a second time to the address the
        // account used to have, so somebody who has taken an account cannot
        // silence the warning by redirecting it to themselves.
        /** @var AnonymousNotifiable $notifiable */
        $address = trim($user !== null
            ? $notification->mailTo($user)
            : (string) ($notifiable->routeNotificationFor('mail') ?? ''));

        if ($address === '') {
            return;
        }

        if (! $this->settings->mailConfigured()) {
            return;
        }

        if (! MailToggle::allows($notification->type())) {
            return;
        }

        // Only an account can hold a preference. An applicant has nowhere to
        // have set one and no way to have set it, so there is nothing to ask.
        if ($user !== null && ! MailPreference::allows($user, $notification->type())) {
            return;
        }

        $content = $notification->mailContent();
        $audience = new MailAudience($this->renderer->appName());

        /*
         * `tenant_id` and `operator_id` come from the recipient, never from
         * the ambient context.
         *
         * A queue worker never passes through IdentifyTenant, so whatever is
         * bound inside one is whatever the last job happened to leave there.
         * `TenantDatabaseChannel` documents arriving at the same conclusion
         * from the other side, and the consequence here is worse: a delivery
         * row filed under the wrong fleet makes the cross-fleet audit query
         * in the mail plan §6 answer wrongly, which is the query that is
         * supposed to catch exactly that mistake.
         */
        $delivery = MailDelivery::create([
            // All three null for an applicant, and correctly so: they belong
            // to no tenant and no fleet yet, and stamping one on the row would
            // make the cross-fleet audit query in mail plan §6 answer wrongly.
            'user_id' => $user?->id,
            'tenant_id' => $user?->tenant_id,
            'operator_id' => $user === null ? null : $audience->operatorIdFor($user),
            'recipient' => $address,
            'type' => $notification->type()->value,
            'subject' => $content->subject,
            'status' => MailDelivery::QUEUED,
            'attempts' => $this->attemptOf($notification),
        ]);

        try {
            ['mailer' => $mailer, 'from_address' => $from, 'from_name' => $fromName] =
                $this->settings->smtpMailer();

            ['html' => $html, 'text' => $text] = $this->renderer->render(
                $content,
                $user !== null
                    ? $audience->reasonFor($user)
                    : __('mail.reason.applicant', ['app' => $this->renderer->appName()]),
                // No preferences link for somebody with no account to hold
                // one. A link to a screen they cannot sign into is worse than
                // no link.
                $user === null ? null : $this->preferencesUrl($notification),
            );

            $mailer->html($html, function ($message) use ($address, $from, $fromName, $content, $text) {
                $message->to($address)
                    ->from($from, $fromName)
                    ->subject($content->subject)
                    ->text($text);

                foreach ($content->attachments as $attachment) {
                    // Decoded here, at the last possible moment. See
                    // `MailContent::hasAttachments()`: the bytes travel as
                    // base64 because a queued notification is serialised with
                    // `json_encode`, which refuses a PDF outright.
                    $message->attachData(
                        base64_decode($attachment['base64'], true) ?: '',
                        $attachment['name'],
                        ['mime' => $attachment['mime']],
                    );
                }
            });

            $delivery->update([
                'status' => MailDelivery::SENT,
                'sent_at' => now(),
            ]);
        } catch (Throwable $e) {
            /*
             * Recorded, then rethrown.
             *
             * The row is what makes the failure visible to support and to the
             * H5 alert, and it has to be written before the exception leaves
             * or a retried job would write a second `queued` row and no
             * failure at all.
             *
             * Rethrowing is what hands the job back to the queue. Swallowing
             * here would make a transient SMTP timeout permanent, and the
             * whole reason mail is queued is that a network is allowed to be
             * briefly unavailable.
             */
            $delivery->update([
                'status' => MailDelivery::FAILED,
                'error' => mb_substr($e->getMessage(), 0, 2000),
            ]);

            $this->soundTheAlarmIfMailIsDown();

            Log::warning('mail.send_failed', [
                'delivery_id' => $delivery->id,
                'type' => $notification->type()->value,
                // The address, not the body. A log line that quotes an email
                // body puts a passenger's pickup address in a file with
                // different retention rules from the database it came from.
                'recipient' => $address,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }

    /**
     * Reports to Sentry once the transport has failed repeatedly (mail plan H5).
     *
     * ## Why this exists at all
     *
     * `MailDelivery::consecutiveFailures()` was written in M0 with a docblock
     * explaining exactly what it was for, and **nothing called it** — the same
     * shape as `MfaService::recoveryCodesAreLow()` before M3 and
     * `ReferralService::rewardMinor()` today. A method that is defined,
     * documented and never consulted is not a feature; it is a comment.
     *
     * ## Three, not one
     *
     * One failure is a typo in somebody's email address. Three in a row with
     * no success between them is a mail server that has stopped working, and
     * only the second is worth waking anybody for. Alerting on the first
     * teaches everyone to ignore the alert, which is how the real outage goes
     * unnoticed.
     *
     * ## Sentry, and deliberately not an email
     *
     * The obvious thing is to email head office. The obvious thing cannot
     * work: **the transport that would carry that email is the thing that has
     * failed.** Anything sent down this path would join the queue of things
     * that are not arriving.
     *
     * `docs/screen-rules.md` requires a Sentry report on a failure path
     * regardless, so this is where the platform already looks. The delivery
     * rows are the other half: a support person can read exactly which
     * messages did not arrive and to whom.
     */
    private function soundTheAlarmIfMailIsDown(): void
    {
        try {
            $run = MailDelivery::consecutiveFailures();

            if ($run < self::OUTAGE_THRESHOLD) {
                return;
            }

            if (app()->bound('sentry')) {
                app('sentry')->captureMessage(sprintf(
                    'Mail transport has failed %d times in a row. No email is leaving the platform.',
                    $run,
                ));
            }

            Log::error('mail.transport_down', ['consecutive_failures' => $run]);
        } catch (Throwable) {
            // An alarm that throws inside a failure handler would replace a
            // mail outage with a queue of unhandleable jobs. It stays quiet
            // and the original exception goes on to be rethrown.
        }
    }

    /**
     * A preferences link, or null for the emails nobody may switch off.
     *
     * Null rather than a link that leads to a screen with the switch greyed
     * out. Offering a choice and then refusing it is worse than not offering
     * it: the reader has been told they can stop these and they cannot.
     */
    private function preferencesUrl(KangaruNotification $notification): ?string
    {
        if ($notification->type()->mailIsRequired()) {
            return null;
        }

        return rtrim((string) config('app.frontend_url'), '/').'/settings/notifications';
    }

    /**
     * Which queue attempt this is, when the job knows.
     *
     * `attempts()` exists on a queued notification's job but not on a
     * synchronous one, so this is guarded rather than assumed. A row reading 3
     * is a mail server that refused twice, which is the difference between one
     * bad address and an outage.
     */
    private function attemptOf(KangaruNotification $notification): int
    {
        $job = $notification->job ?? null;

        // `$job` is typed loosely on the framework's `Queueable` trait and is
        // a string on a synchronous send, so both checks are load-bearing:
        // `is_object` for the string case, `method_exists` for a queue driver
        // whose job class does not carry attempt counts.
        if (is_object($job) && method_exists($job, 'attempts')) {
            return (int) $job->attempts();
        }

        return 1;
    }
}
