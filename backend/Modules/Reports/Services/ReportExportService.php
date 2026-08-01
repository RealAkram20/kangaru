<?php

namespace Modules\Reports\Services;

use App\Models\User;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Jobs\GenerateReportExport;
use Modules\Reports\Models\ReportExport;

class ReportExportService
{
    public function __construct(private readonly ReportSourceFactory $sources) {}

    /**
     * Records the request and queues the work.
     *
     * The row ceiling is checked here, before anything is queued, so a PDF
     * request that cannot succeed is refused with an explanation the user
     * can act on rather than a job that dies twenty minutes later in a
     * worker nobody is watching.
     *
     * @param  array<string, mixed>  $filters
     *
     * @throws ReportTooLargeException
     */
    public function request(ReportType $report, array $filters, ExportFormat $format, User $requester): ReportExport
    {
        $limit = $format->rowLimit();

        if ($limit !== null) {
            $rows = $this->sources->for($report)->count($filters);

            if ($rows > $limit) {
                throw new ReportTooLargeException($format, $rows, $limit);
            }
        }

        $export = ReportExport::create([
            'tenant_id' => $requester->tenant_id,
            'requested_by_user_id' => $requester->id,
            'report' => $report,
            'format' => $format,
            'status' => ExportStatus::QUEUED,
            'filters' => $filters,
        ]);

        GenerateReportExport::dispatch($export->id);

        return $export;
    }
}
