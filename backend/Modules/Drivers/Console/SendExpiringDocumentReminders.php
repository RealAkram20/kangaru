<?php

namespace Modules\Drivers\Console;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Notifications\DriverEventNotification;

/**
 * Warns a driver before a document expires, and on the day it does.
 *
 * ## The gap this closes
 *
 * AGENTS.md names *"Document Expiring"* on its short list of notifications
 * worth having, and it was the one item on that list with nothing behind it.
 * `driver_documents.expires_at` has been a column since ADR-0052 and **nothing
 * has ever read it on a schedule.** A licence could lapse with the driver and
 * the office both finding out when a traffic officer did.
 *
 * ## Fixed offsets, not a window
 *
 * 30 days, 7 days, and the day itself. Exact date matches rather than
 * "expiring within a month", and that is what makes this idempotent without a
 * `reminded_at` column: a document is exactly 30 days from expiry on exactly
 * one calendar day, so a daily run can only match it once.
 *
 * The consequence, stated because it is a real trade: **a skipped day is not
 * sent late, it is not sent at all.** That is the right way round. A "30 days
 * left" email that arrives on day 26 is wrong in a way the reader cannot
 * detect, and the 7-day warning will catch them anyway.
 *
 * ## Kampala's calendar, not the server's
 *
 * `expires_at` is a date, not a datetime, because a licence expires on a day
 * (the migration says so). "Today" therefore has to be today *where the driver
 * is*, and taking it from the server clock would shift every offset by a day
 * for six hours out of every twenty-four. `DriverEarningsService::timezone()`
 * is the platform's answer to that question and is already what the earnings
 * screens use.
 *
 * This is not hypothetical: a sibling test in this suite failed for exactly
 * this reason, deterministically, between midnight and 06:00 Kampala time on a
 * Monday.
 *
 * ## Only documents that are actually holding somebody up
 *
 * Verified documents only. A pending one is already in the office's queue and
 * a rejected one has its own notification (ADR-0052); telling a driver their
 * rejected licence is about to expire is two messages about one problem.
 */
class SendExpiringDocumentReminders extends Command
{
    /** Days before expiry that earn a warning, in the order they are sent. */
    public const OFFSETS = [30, 7];

    protected $signature = 'drivers:remind-expiring-documents';

    protected $description = 'Warn drivers whose documents expire in 30 or 7 days, and on the day they lapse';

    public function handle(DriverEarningsService $earnings): int
    {
        $today = CarbonImmutable::now($earnings->timezone())->startOfDay();

        $sent = 0;

        foreach (self::OFFSETS as $days) {
            $sent += $this->remindFor(
                $today->addDays($days),
                NotificationType::DRIVER_DOCUMENT_EXPIRING,
                $days,
            );
        }

        $sent += $this->remindFor($today, NotificationType::DRIVER_DOCUMENT_EXPIRED, 0);

        $this->info("{$sent} document reminder(s) sent.");

        return self::SUCCESS;
    }

    /**
     * Notifies every driver whose verified document expires on this date.
     *
     * Named `remindFor` and not `warn`, which was the first name and is a
     * **public method on `Illuminate\Console\Command`** for writing a yellow
     * line to the console. PHP refuses the narrowing outright, which is the
     * good outcome: silently overriding it would have broken console output
     * for this command and nothing would have said so.
     */
    private function remindFor(CarbonImmutable $on, NotificationType $type, int $daysLeft): int
    {
        $documents = DriverDocument::query()
            ->whereDate('expires_at', $on->toDateString())
            ->where('status', DriverDocumentStatus::VERIFIED->value)
            // Eager loaded: this runs over every driver on the platform and a
            // lazy `driver` per row is the N+1 that turns a nightly sweep into
            // a slow one.
            //
            // No fleet name in the facts. `Driver` has no `operator()`
            // relation and adding one to reach a nice-to-have line would be a
            // shared-model edit for decoration. The driver knows who they
            // drive for.
            ->with(['driver.user'])
            ->get();

        $sent = 0;

        foreach ($documents as $document) {
            $user = $document->driver?->user;

            // A document with no signed-in driver behind it is an applicant's
            // or an orphan. Neither has an inbox this can reach, and the
            // office's own list is where those belong.
            if ($user === null) {
                continue;
            }

            $facts = array_filter([
                __('mail.driver.fact_document') => $document->type->label(),
                ($daysLeft === 0 ? __('mail.driver.fact_expired_on') : __('mail.driver.fact_expires')) => $document->expires_at?->isoFormat('D MMMM YYYY') ?? '',
            ]);

            $user->notify(new DriverEventNotification($type, $facts));
            $sent++;
        }

        return $sent;
    }
}
