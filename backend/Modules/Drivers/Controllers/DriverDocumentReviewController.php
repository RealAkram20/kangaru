<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Requests\RejectDriverDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
use Modules\Drivers\Services\DriverDocumentService;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The office side of a driver's papers (ADR-0033 §4).
 *
 * **Verify and reject are POSTs to sub-paths rather than a PATCH on a status
 * field**, for the reason the driver-application and settlement decisions are:
 * each is a decision with its own audit meaning, and a status field would make
 * accepting somebody's licence look like an edit.
 *
 * **Nothing here verifies a document by itself.** There is no OCR, no
 * third-party check, and no rule that accepts a document because its expiry is
 * in the future. A machine that marks a licence verified is the original
 * problem wearing a better hat.
 */
class DriverDocumentReviewController extends Controller
{
    public function __construct(private readonly DriverDocumentService $documents) {}

    /**
     * One driver's documents, every type, held or not.
     *
     * The same shape the driver's own endpoint serves, so the console and the
     * app render one vocabulary — an office asked "what is missing" needs the
     * empty slots as much as the driver does.
     */
    public function index(Request $request, Driver $driver): JsonResponse
    {
        $this->authorize('viewAny', DriverDocument::class);

        $timezone = $this->documents->timezone();

        $rows = array_map(
            fn (array $row): array => [
                'type' => $row['type']->value,
                'type_label' => $row['type']->label(),
                'hint' => $row['type']->hint(),
                'requires_expiry' => $row['type']->requiresExpiry(),
                'document' => $row['document'] === null
                    ? null
                    : (new DriverDocumentResource($row['document'], $timezone))->toArray($request),
            ],
            $this->documents->forDriver($driver),
        );

        return ApiResponse::success(
            $rows,
            'Driver documents retrieved.',
            200,
            ['compliance' => $this->documents->complianceFor($driver)],
        );
    }

    /** The file, streamed behind the policy — never a storage URL. */
    public function file(Driver $driver, DriverDocument $document): StreamedResponse|JsonResponse
    {
        $this->authorize('view', $document);

        // The document must belong to the driver in the path. Without this a
        // correct driver id and any document id addresses somebody else's
        // licence — and the policy would allow it, because the reviewer holds
        // `drivers.manage` over every driver. A mismatched pair is a 404
        // rather than a 403: the resource named by *this* path does not exist.
        if ($document->driver_id !== $driver->getKey()) {
            return $this->notThisDriver();
        }

        if (! Storage::exists($document->file_path)) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'That document file is no longer on file.',
                [],
                404,
            );
        }

        return Storage::response($document->file_path);
    }

    public function verify(Request $request, Driver $driver, DriverDocument $document): JsonResponse
    {
        $this->authorize('review', $document);

        if ($document->driver_id !== $driver->getKey()) {
            return $this->notThisDriver();
        }

        /** @var User $reviewer */
        $reviewer = $request->user();

        $document = $this->documents->verify($document, $reviewer);

        return ApiResponse::success(
            (new DriverDocumentResource($document, $this->documents->timezone()))->toArray($request),
            'Document verified.',
        );
    }

    public function reject(
        RejectDriverDocumentRequest $request,
        Driver $driver,
        DriverDocument $document,
    ): JsonResponse {
        $this->authorize('review', $document);

        if ($document->driver_id !== $driver->getKey()) {
            return $this->notThisDriver();
        }

        /** @var User $reviewer */
        $reviewer = $request->user();

        $document = $this->documents->reject(
            $document,
            $reviewer,
            (string) $request->validated('reason'),
        );

        return ApiResponse::success(
            (new DriverDocumentResource($document, $this->documents->timezone()))->toArray($request),
            'Document rejected.',
        );
    }

    private function notThisDriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_FOUND,
            'That document does not belong to this driver.',
            [],
            404,
        );
    }
}
