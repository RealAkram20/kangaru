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
use Modules\Drivers\Requests\StoreDriverDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
use Modules\Drivers\Resources\DriverDocumentSlots;
use Modules\Drivers\Services\DriverDocumentService;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * A driver's own papers (ADR-0033).
 *
 * Under `/me`, so the subject is the token and there is no id to authorise
 * against — except on `file()`, which takes a document id and is therefore the
 * one method here with a policy check. That difference is the whole reason
 * `DriverDocumentPolicy::view()` grants an owner ability at all.
 */
class DriverDocumentController extends Controller
{
    public function __construct(private readonly DriverDocumentService $documents) {}

    /**
     * Every type, held or not.
     *
     * **The missing ones are the point.** A driver opening this screen is
     * asking "what do I still owe you", and only the full set answers that —
     * so an un-uploaded type comes back as a real type with a null document
     * rather than being omitted.
     */
    public function index(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

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
     * Upload, or replace what is already held of that type.
     *
     * **Not routed through the offline outbox**, unlike every other mutation
     * this app makes. ADR-0023 queues state transitions, which are small JSON
     * payloads; an eight-megabyte photograph in an AsyncStorage-backed queue is
     * a different problem. This needs a connection and the screen says so —
     * the same exception `changePassword` already is.
     */
    public function store(StoreDriverDocumentRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

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
            'Document sent to the office.',
            201,
        );
    }

    /**
     * The file itself, decrypted on the way out (ADR-0053).
     *
     * Never a storage URL: a signed link to somebody's identity document is
     * addressable by anyone who ever saw it, for as long as it lives
     * (ADR-0033 §5). `OdometerPhotoController` makes the same argument about a
     * dashboard photograph, and it applies here more strongly.
     *
     * The decryption lives in `DriverDocumentStore` and not here, because the
     * office's review controller streams the same rows and a branch present in
     * one of the two would serve ciphertext to exactly one audience.
     */
    public function file(Request $request, DriverDocument $document): StreamedResponse|JsonResponse
    {
        $this->authorize('view', $document);

        $download = $this->documents->download($document);

        if ($download === null) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'That document file is no longer on file. Upload it again.',
                [],
                404,
            );
        }

        return $download;
    }

    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile.',
            [],
            403,
        );
    }
}
