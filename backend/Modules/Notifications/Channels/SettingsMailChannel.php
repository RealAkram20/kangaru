<?php

namespace Modules\Notifications\Channels;

use App\Models\User;
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
    public function __construct(
        private readonly SettingsService $settings,
        private readonly MailRenderer $renderer,
    ) {}

    public function send(object $notifiable, LaravelNotification $notification): void
    {
        if (! $notifiable instanceof User || ! $notification instanceof KangaruNotification) {
            return;
        }

        // Asked of the notification rather than read off the user, because
        // one type deliberately does not go to the account's current address:
        // `ACCOUNT_EMAIL_CHANGED` is sent a second time to the address the
        // account used to have, so somebody who has taken an account cannot
        // silence the warning by redirecting it to themselves.
        $address = trim($notification->mailTo($notifiable));

        if ($address === '') {
            return;
        }

        if (! $this->settings->mailConfigured()) {
            return;
        }

        if (! MailToggle::allows($notification->type())) {
            return;
        }

        if (! MailPreference::allows($notifiable, $notification->type())) {
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
            'user_id' => $notifiable->id,
            'tenant_id' => $notifiable->tenant_id,
            'operator_id' => $audience->operatorIdFor($notifiable),
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
                $audience->reasonFor($notifiable),
                $this->preferencesUrl($notification),
            );

            $mailer->html($html, function ($message) use ($address, $from, $fromName, $content, $text) {
                $message->to($address)
                    ->from($from, $fromName)
                    ->subject($content->subject)
                    ->text($text);
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

        if ($job !== null && method_exists($job, 'attempts')) {
            return (int) $job->attempts();
        }

        return 1;
    }
}
