<?php

namespace Modules\Reports\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Reports\Repositories\TripReportRepository;
use Modules\Reports\Requests\TripReportRequest;
use Modules\Reports\Resources\TripReportRowResource;
use Modules\Reports\Services\TripReportCsv;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TripReportController extends Controller
{
    public function __construct(
        private readonly TripReportRepository $reports,
        private readonly TripReportCsv $csv,
    ) {}

    public function index(TripReportRequest $request): JsonResponse
    {
        $this->authorize('viewReports');

        $filters = $request->filters();

        $paginator = $this->reports->query($filters)->cursorPaginate(50);

        return ApiResponse::success(
            TripReportRowResource::collection($paginator->getCollection()),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // Computed over the whole filtered set, not the page — a
                // total distance that only covered the visible rows would
                // be read as the month's figure and be wrong.
                'summary' => $this->reports->summary($filters),
            ],
        );
    }

    public function export(TripReportRequest $request): StreamedResponse|JsonResponse
    {
        $this->authorize('viewReports');

        $filters = $request->filters();
        $rows = $this->reports->query($filters)->toBase()->getCountForPagination();

        if ($rows > TripReportCsv::EXPORT_ROW_LIMIT) {
            return ApiResponse::error(
                ErrorCode::REPORT_TOO_LARGE,
                'This report covers '.number_format($rows).' trips, which is more than can be exported in one '.
                'download. Narrow the date range or filter by vehicle or driver and try again.',
                [],
                422,
            );
        }

        return $this->csv->stream($filters, $this->filename($filters));
    }

    /**
     * @param  array<string, mixed>  $filters
     */
    private function filename(array $filters): string
    {
        $from = isset($filters['from']) ? date('Y-m-d', strtotime((string) $filters['from'])) : 'all';
        $to = isset($filters['to']) ? date('Y-m-d', strtotime((string) $filters['to'])) : 'all';

        return "kangaruride-trip-report-{$from}-to-{$to}.csv";
    }
}
