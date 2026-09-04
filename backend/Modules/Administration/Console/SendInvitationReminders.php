<?php

namespace Modules\Administration\Console;

use Illuminate\Console\Command;
use Modules\Administration\Models\Invitation;
use Modules\Administration\Services\InvitationService;
use Modules\Notifications\Notifications\InvitationExpiringNotification;

/**
 * One reminder, twenty four hours before an invitation lapses (mail plan A2).
 *
 * ## Why the window and not a flag
 *
 * There is no `reminded_at` column, and there does not need to be. The command
 * runs once a day and selects invitations expiring inside the next
 * `REMIND_WITHIN_HOURS`, so an invitation can only fall inside that window on
 * one run. A second column would be a second thing that can disagree with the
 * clock.
 *
 * The consequence to know about: **if this command is skipped for a day, that
 * day's reminders are not sent late, they are not sent at all.** That is the
 * right trade. A reminder that arrives after the link has already died is
 * worse than silence, because it sends somebody to look for an email that no
 * longer works.
 *
 * ## Why anybody should care
 *
 * An unaccepted invitation is somebody who cannot sign in and may not have
 * realised it yet. For a fleet owner it is worse than that: ADR-0059 §5 says a
 * fleet's account count may never reach zero, and a fleet whose only account
 * holder let the link lapse is one password reset away from that being true in
 * practice.
 */
class SendInvitationReminders extends Command
{
    protected $signature = 'invitations:remind';

    protected $description = 'Warn anybody whose invitation link lapses within a day';

    public function handle(InvitationService $invitations): int
    {
        $sent = 0;

        foreach ($invitations->expiringSoon() as $invitation) {
            $user = $invitation->user;

            if ($user === null) {
                continue;
            }

            $user->notify(new InvitationExpiringNotification($invitation));
            $sent++;
        }

        $this->info(sprintf(
            '%d invitation reminder(s) sent for links expiring within %d hours.',
            $sent,
            Invitation::REMIND_WITHIN_HOURS,
        ));

        return self::SUCCESS;
    }
}
