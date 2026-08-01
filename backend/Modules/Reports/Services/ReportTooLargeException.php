<?php

namespace Modules\Reports\Services;

use Modules\Reports\Enums\ExportFormat;
use RuntimeException;

/**
 * Refused before queuing rather than truncated. A silently short report is
 * a billing dispute, and a job that dies halfway leaves the user watching a
 * spinner with no explanation.
 */
class ReportTooLargeException extends RuntimeException
{
    public function __construct(
        public readonly ExportFormat $format,
        public readonly int $rows,
        public readonly int $limit,
    ) {
        parent::__construct(sprintf(
            'This report covers %s trips, which is more than the %s format can hold (%s). '.
            'Narrow the date range, filter by vehicle or driver, or export it as CSV or Excel instead.',
            number_format($rows),
            $format->label(),
            number_format($limit),
        ));
    }
}
