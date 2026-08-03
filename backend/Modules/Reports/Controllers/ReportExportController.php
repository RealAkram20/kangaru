<?php

namespace Modules\Reports\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Models\ReportExport;
use Modules\Reports\Requests\RequestExportRequest;
use Modules\Reports\Resources\ReportExportResource;
use Modules\Reports\Services\ReportExportService;
use Modules\Reports\Services\ReportTooLargeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportExportController extends Controller
{
    public function __construct(private readonly ReportExportService $exports) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewReports');

        /** @var User $user */
        $user = $request->user();

        // Filtered rather than gated wholesale: the list is a mix of report
        // types, and a reader entitled to trip exports should still see
        // theirs. Withholding the rows they may not read is the difference
        // between a filtered list and a leak — an export row carries the
        // filters it was run with and who ran it, which is itself telling.
        $readable = array_values(array_filter(
            ReportType::cases(),
            fn (ReportType $type) => $type->isReadableBy($user),
        ));

        $exports = ReportExport::with('requestedBy')
            ->whereIn('report', array_map(fn (ReportType $type) => $type->value, $readable))
            ->latest('id')
            ->limit(20)
            ->get();

        return ApiResponse::success(ReportExportResource::collection($exports));
    }

    public function store(RequestExportRequest $request): JsonResponse
    {
        // The requested report, not the reports area in general. Queueing an
        // export was the widest hole: it produced a downloadable file of
        // data the caller could not read on screen.
        $this->authorize('viewReport', $request->reportType());

        /** @var User $user */
        $user = $request->user();

        try {
            $export = $this->exports->request(
                $request->reportType(),
                $request->filters(),
                $request->exportFormat(),
                $user,
                // ADR-0007 rule 4. Resolved here and persisted on the row,
                // so the file the worker writes minutes later covers what
                // was asked for — not whatever the requester's own tenancy
                // or permissions happen to be by then.
                $request->reportScope(),
            );
        } catch (ReportTooLargeException $e) {
            return ApiResponse::error(ErrorCode::REPORT_TOO_LARGE, $e->getMessage(), [], 422);
        }

        // 202, not 201: the resource exists but the file it describes does
        // not yet. The client polls `show` until `is_terminal`.
        return ApiResponse::success(
            new ReportExportResource($export),
            'Your export is being prepared. It will appear in the list below when it is ready.',
            202,
        );
    }

    public function show(ReportExport $export): JsonResponse
    {
        // Gated on what this export actually holds, not on what was asked
        // for — the row is the record of a file that already exists.
        $this->authorize('viewReport', $export->report);

        return ApiResponse::success(new ReportExportResource($export->load('requestedBy')));
    }

    /**
     * Route-model binding runs through TenantScope, so another tenant's
     * export id is a 404 before reaching here — the file itself is never
     * addressable across tenants (ADR-0001).
     */
    public function download(Request $request, ReportExport $export): StreamedResponse|JsonResponse
    {
        // The last gate before bytes leave the building, and the one that
        // matters most: a file already on disk, addressable by id.
        $this->authorize('viewReport', $export->report);

        if (! $export->status->isDownloadable()) {
            return ApiResponse::error(
                ErrorCode::EXPORT_NOT_READY,
                $export->error ?? 'This export is still being prepared. Please try again shortly.',
                [],
                409,
            );
        }

        if ($export->isExpired() || $export->path === null || ! Storage::exists($export->path)) {
            return ApiResponse::error(
                ErrorCode::EXPORT_EXPIRED,
                'This export is no longer available. Exports are kept for seven days — please request it again.',
                [],
                410,
            );
        }

        return Storage::download($export->path, basename($export->path), [
            'Content-Type' => $export->format->mimeType(),
        ]);
    }
}
