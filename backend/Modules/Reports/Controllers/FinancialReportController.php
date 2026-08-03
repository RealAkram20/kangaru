<?php

namespace Modules\Reports\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
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
        // `reports.view` **and** `invoices.view` (ReportType::permissions()).
        //
        // This used to be the bare `viewReports` gate, reasoned as: Operations
        // Manager and Corporate Admin can already list every invoice, so
        // withholding their total would be pointless. True of those two, and
        // the reason this survived — but they are not the whole set.
        // Dispatcher, Branch Manager, Depot Manager and Fleet Owner hold
        // `reports.view` and not `invoices.view`, and this endpoint was
        // handing them a client's invoiced, credited and outstanding figures
        // that /invoices refuses them.
        $this->authorize('viewReport', ReportType::FINANCIAL);

        // ADR-0007 rule 2, and the sharp edge of the whole decision: for
        // platform staff `tenant_id` is *required*, so a request that
        // reaches this line has already named one client. There is no
        // branch here that produces a cross-client revenue total, because
        // FinancialReportRequest refuses the request that would ask for
        // one — 422, not a figure nobody agreed the meaning of.
        $scope = $request->reportScope();

        /** @var User $actor */
        $actor = $request->user();

        $source = $this->sources->for(ReportType::FINANCIAL, $scope);
        $filters = $request->filters();

        return ApiResponse::success(
            iterator_to_array($source->rows($filters)),
            meta: [
                'report' => ReportType::FINANCIAL->value,
                'title' => $source->title(),
                'headers' => $source->headers(),
                'period' => $source->period($filters),
                'summary' => $source->summary($filters),
                ...$scope->metaFor($actor),
            ],
        );
    }
}
