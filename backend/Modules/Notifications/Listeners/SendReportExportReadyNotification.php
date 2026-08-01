<?php

namespace Modules\Notifications\Listeners;

use Illuminate\Support\Facades\Notification;
use Modules\Notifications\Notifications\ReportExportReadyNotification;
use Modules\Reports\Events\ReportExportCompleted;

/**
 * Tells whoever requested a report file that it has finished.
 *
 * Closes the gap Modules/Reports names in its own deferred list: the
 * request returns 202 and the file appears later, so until now the only way
 * to learn it was ready was to keep the page open and let it poll.
 */
class SendReportExportReadyNotification
{
    public function handle(ReportExportCompleted $event): void
    {
        $requester = $event->export->requestedBy;

        if ($requester === null) {
            return;
        }

        Notification::send($requester, ReportExportReadyNotification::for($event->export));
    }
}
