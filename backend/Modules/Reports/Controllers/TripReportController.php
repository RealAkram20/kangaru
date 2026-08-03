<?php

namespace Modules\Reports\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
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

        /** @var User $actor */
        $actor = $request->user();

        $filters = $request->filters();

        // ADR-0007. Optional for platform staff: with `?tenant_id=` this is
        // one client's report, without it every client's. A client's own
        // user cannot send the parameter at all, so their scope is always
        // their own tenant.
        $scope = $request->reportScope();

        $paginator = $this->reports->query($filters, $scope)->cursorPaginate(50);

        return ApiResponse::success(
            TripReportRowResource::collection($paginator->getCollection()),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // Computed over the whole filtered set, not the page — a
                // total distance that only covered the visible rows would
                // be read as the month's figure and be wrong.
                'summary' => $this->reports->summary($filters, $scope),
                // Rule 5: a report that spans clients must say so. This one
                // carries `records_incomplete`, which PROJECT.md defines
                // per client — spanning turns it into a platform average,
                // and the label is what stops it being read as the former.
                ...$scope->metaFor($actor),
            ],
        );
    }
}
