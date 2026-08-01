<?php

namespace Modules\Reports\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Requests\FleetReportRequest;

/**
 * The driver and vehicle reports.
 *
 * Both are aggregates — one row per driver or vehicle — so neither is
 * paginated: a tenant has tens of drivers, not tens of thousands, and a
 * cursor over a GROUP BY would cost more than it saved. The trip report,
 * which is row-per-trip, keeps its cursor.
 *
 * Rows come from the same ReportSource the exporter uses, so what is on
 * screen and what is in the spreadsheet cannot disagree about a column or a
 * total.
 */
class FleetReportController extends Controller
{
    public function __construct(private readonly ReportSourceFactory $sources) {}

    public function drivers(FleetReportRequest $request): JsonResponse
    {
        return $this->render(ReportType::DRIVERS, $request);
    }

    public function vehicles(FleetReportRequest $request): JsonResponse
    {
        return $this->render(ReportType::VEHICLES, $request);
    }

    private function render(ReportType $type, FleetReportRequest $request): JsonResponse
    {
        // A report spans the whole tenant's fleet, which is more than a
        // driver or a corporate employee should see — the same gate the
        // trip report uses.
        $this->authorize('viewReports');

        $source = $this->sources->for($type);
        $filters = $request->filters();

        // Column headers travel with the data. The alternative is a client
        // holding its own copy of the column list, which drifts the first
        // time a figure is added and silently mislabels every row.
        return ApiResponse::success(
            iterator_to_array($source->rows($filters)),
            meta: [
                'report' => $type->value,
                'title' => $source->title(),
                'headers' => $source->headers(),
                'period' => $source->period($filters),
                'summary' => $source->summary($filters),
            ],
        );
    }
}
