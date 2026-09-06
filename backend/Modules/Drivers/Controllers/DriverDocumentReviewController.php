<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Requests\RejectDriverDocumentRequest;
use Modules\Drivers\Requests\StoreDriverDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
use Modules\Drivers\Resources\DriverDocumentSlots;
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

        // One presenter, three screens (`DriverDocumentSlots`). This shape was
        // built by hand here and in the other controller, and ADR-0048 added a
        // third caller — which is where a drifting `hint` stops being
        // duplication and starts being a field asked for on one surface only.
        $rows = DriverDocumentSlots::toArray(
            $this->documents->forDriver($driver),
            $timezone,
            $request,
        );

        return ApiResponse::success(
            $rows,
            'Driver documents retrieved.',
            200,
            ['compliance' => $this->documents->complianceFor($driver)],
        );
    }

    /**
     * The office files a document on a driver's behalf (ADR-0052 §5).
     *
     * A driver hands their licence across the counter, or emails a scan, or
     * photographs it badly six times in a row and gives up. Until now the only
     * way a document reached this platform was the handset in that driver's
     * pocket, which is the same gap ADR-0048 found for driver *creation*: the
     * API could do it and no human could.
     *
     * **`StoreDriverDocumentRequest`, unchanged and shared with the driver's
     * own endpoint.** The size ceiling, the mime list, the expiry rule and the
     * per-type "this one needs a date" check are identical because the
     * *document* is identical — only the person holding the file differs. A
     * second request class here would be the drift ADR-0048 §3 argues against,
     * one layer up.
     *
     * **This does not verify anything.** `upload()` writes `pending` and
     * clears every review field, so filing a document and accepting it stay
     * two acts by two deliberate decisions — ADR-0033 §4's "nothing is
     * auto-verified, ever" applies to the office as much as to a machine.
     * The office member who uploads it may then verify it, and that is a
     * second click that leaves a second audit entry.
     */
    public function store(StoreDriverDocumentRequest $request, Driver $driver): JsonResponse
    {
        $this->authorize('create', DriverDocument::class);

        $type = DriverDocumentType::from((string) $request->validated('type'));

        /** @var UploadedFile $file */
        $file = $request->file('file');

        $expiresAt = $request->validated('expires_at');

        $document = $this->documents->upload(
            $driver,
            $type,
            $file,
            is_string($expiresAt) && $expiresAt !== '' ? $expiresAt : null,
        );

        return ApiResponse::success(
            (new DriverDocumentResource($document->fresh() ?? $document, $this->documents->timezone()))
                ->toArray($request),
            'Document filed. It still needs to be checked.',
            201,
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

        // Decrypted by the store, which is the only thing that knows the bytes
        // on disk are ciphertext (ADR-0053). The driver's own controller reads
        // the same rows through the same method, so the two cannot drift into
        // serving different things.
        $download = $this->documents->download($document);

        if ($download === null) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'That document file is no longer on file.',
                [],
                404,
            );
        }

        return $download;
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
