<?php

namespace Modules\Reports\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Reports\Repositories\TripReportRepository;
use Modules\Reports\Requests\TripReportRequest;
use Modules\Reports\Resources\TripReportRowResource;

/**
 * The on-screen report. File output is a separate resource — see
 * ReportExportController — because it is produced asynchronously and
 * outlives the request that asked for it.
 */
class TripReportController extends Controller
{
    public function __construct(private readonly TripReportRepository $reports) {}

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
}
