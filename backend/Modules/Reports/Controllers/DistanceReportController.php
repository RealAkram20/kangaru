<?php

namespace Modules\Reports\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Reports\Repositories\DistanceReportRepository;
use Modules\Reports\Requests\DistanceReportRequest;
use Modules\Reports\Resources\DistanceReportRowResource;

/**
 * The measured-distance shadow report (ADR-0045).
 *
 * The instrument Phase 1 of `docs/measured-distance-plan.md` exists to
 * produce: every completed trip's latest resolution, and over the whole
 * filtered set the grade, coverage and deviation distributions the flip to
 * trace-priced fares is judged against. On-screen only; not exportable —
 * see `DistanceReportRequest` for why it is not a `ReportType`.
 */
class DistanceReportController extends Controller
{
    public function __construct(private readonly DistanceReportRepository $reports) {}

    public function index(DistanceReportRequest $request): JsonResponse
    {
        $this->authorize('viewReports');

        /** @var User $actor */
        $actor = $request->user();

        $filters = $request->filters();
        $scope = $request->reportScope();

        $paginator = $this->reports->rows($filters, $scope)->cursorPaginate(50);

        return ApiResponse::success(
            DistanceReportRowResource::collection(collect($paginator->items())),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // Over the whole filtered set, not the page: a grade
                // distribution of the visible fifty would be read as the
                // month's and be wrong.
                'summary' => $this->reports->summary($filters, $scope),
                ...$scope->metaFor($actor),
            ],
        );
    }
}
