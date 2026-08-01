<?php

namespace Modules\Reports\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Requests\FinancialReportRequest;

/**
 * The financial report — PROJECT.md's fourth.
 *
 * Not paginated. Rows are periods, and the range that would produce a large
 * number of them (a decade grouped daily) is not one anybody asks for; a
 * cursor over a GROUP BY would cost more than it saved, which is the same
 * call the driver and vehicle reports make.
 *
 * Rows come from the same ReportSource the exporter uses, so the screen and
 * the spreadsheet cannot disagree about a column or a total.
 */
class FinancialReportController extends Controller
{
    public function __construct(private readonly ReportSourceFactory $sources) {}

    public function index(FinancialReportRequest $request): JsonResponse
    {
        // The same gate the other reports use. This one arguably wants a
        // narrower one — it is the tenant's money rather than its mileage —
        // but Operations Manager and Corporate Admin can already read every
        // invoice through Modules/Billing's own `viewAny`, so a stricter
        // gate here would withhold the total of figures they can already
        // list one by one. The place to tighten that is InvoicePolicy.
        $this->authorize('viewReports');

        $source = $this->sources->for(ReportType::FINANCIAL);
        $filters = $request->filters();

        return ApiResponse::success(
            iterator_to_array($source->rows($filters)),
            meta: [
                'report' => ReportType::FINANCIAL->value,
                'title' => $source->title(),
                'headers' => $source->headers(),
                'period' => $source->period($filters),
                'summary' => $source->summary($filters),
            ],
        );
    }
}
