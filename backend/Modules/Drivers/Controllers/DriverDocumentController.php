<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Requests\StoreDriverDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
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
     * The file itself, streamed.
     *
     * Never a storage URL: a signed link to somebody's identity document is
     * addressable by anyone who ever saw it, for as long as it lives
     * (ADR-0033 §5). `OdometerPhotoController` makes the same argument about a
     * dashboard photograph, and it applies here more strongly.
     */
    public function file(Request $request, DriverDocument $document): StreamedResponse|JsonResponse
    {
        $this->authorize('view', $document);

        if (! Storage::exists($document->file_path)) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'That document file is no longer on file. Upload it again.',
                [],
                404,
            );
        }

        return Storage::response($document->file_path);
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
