<?php

namespace Modules\Reports\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Modules\Reports\Models\ReportExport;

/**
 * An export finished generating and its file is on disk.
 *
 * Dispatched by GenerateReportExport after the row reaches `completed`,
 * never before: a notification saying a file is ready must not arrive
 * ahead of the file.
 *
 * There is deliberately no matching failure event. A failed export already
 * surfaces on the export list with the reason, and notifying someone that
 * a thing they are watching has failed — while they watch it — adds noise
 * without adding information. That changes if exports are ever scheduled
 * rather than requested, because then nobody is watching.
 */
class ReportExportCompleted
{
    use Dispatchable;

    public function __construct(public readonly ReportExport $export) {}
}
