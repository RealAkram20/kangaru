<?php

namespace Modules\Reports\Services;

use App\Models\User;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Jobs\GenerateTripReportExport;
use Modules\Reports\Models\ReportExport;
use Modules\Reports\Repositories\TripReportRepository;

class ReportExportService
{
    public function __construct(private readonly TripReportRepository $repository) {}

    /**
     * Records the request and queues the work.
     *
     * @param  array<string, mixed>  $filters
     *
     * @throws ReportTooLargeException
     */
    public function requestTripReport(array $filters, ExportFormat $format, User $requester): ReportExport
    {
        $limit = $format->rowLimit();

        if ($limit !== null) {
            $rows = $this->repository->query($filters)->toBase()->getCountForPagination();

            if ($rows > $limit) {
                throw new ReportTooLargeException($format, $rows, $limit);
            }
        }

        $export = ReportExport::create([
            'tenant_id' => $requester->tenant_id,
            'requested_by_user_id' => $requester->id,
            'report' => 'trips',
            'format' => $format,
            'status' => ExportStatus::QUEUED,
            'filters' => $filters,
        ]);

        GenerateTripReportExport::dispatch($export->id);

        return $export;
    }
}
