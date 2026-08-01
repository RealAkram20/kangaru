<?php

namespace Modules\Reports\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Modules\Reports\Models\ReportExport;
use Modules\Reports\Requests\RequestExportRequest;
use Modules\Reports\Resources\ReportExportResource;
use Modules\Reports\Services\ReportExportService;
use Modules\Reports\Services\ReportTooLargeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportExportController extends Controller
{
    public function __construct(private readonly ReportExportService $exports) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewReports');

        $exports = ReportExport::with('requestedBy')
            ->latest('id')
            ->limit(20)
            ->get();

        return ApiResponse::success(ReportExportResource::collection($exports));
    }

    public function store(RequestExportRequest $request): JsonResponse
    {
        $this->authorize('viewReports');

        /** @var User $user */
        $user = $request->user();

        try {
            $export = $this->exports->request($request->reportType(), $request->filters(), $request->exportFormat(), $user);
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
        $this->authorize('viewReports');

        return ApiResponse::success(new ReportExportResource($export->load('requestedBy')));
    }

    /**
     * Route-model binding runs through TenantScope, so another tenant's
     * export id is a 404 before reaching here — the file itself is never
     * addressable across tenants (ADR-0001).
     */
    public function download(Request $request, ReportExport $export): StreamedResponse|JsonResponse
    {
        $this->authorize('viewReports');

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
