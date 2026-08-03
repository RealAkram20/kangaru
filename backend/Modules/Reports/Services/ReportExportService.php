<?php

namespace Modules\Reports\Services;

use App\Models\User;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Jobs\GenerateReportExport;
use Modules\Reports\Models\ReportExport;
use Modules\Reports\Support\ReportScope;

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
    public function request(
        ReportType $report,
        array $filters,
        ExportFormat $format,
        User $requester,
        ReportScope $scope,
    ): ReportExport {
        $limit = $format->rowLimit();

        if ($limit !== null) {
            // Counted under the same scope the file will be written under.
            // Counting under a different one is how a PDF passes its
            // ceiling check and then exceeds it in the worker.
            $rows = $this->sources->for($report, $scope)->count($filters);

            if ($rows > $limit) {
                throw new ReportTooLargeException($format, $rows, $limit);
            }
        }

        $export = ReportExport::create([
            // The tenant the report is **for**, not the one the requester
            // belongs to (ADR-0007 rule 4). Those were the same thing until
            // platform staff existed; taking it from `$requester` is what
            // made this insert throw an integrity violation for them, and
            // would have filed a client's export under the wrong tenant if
            // the column had been nullable at the time.
            'tenant_id' => $scope->tenantId,
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
