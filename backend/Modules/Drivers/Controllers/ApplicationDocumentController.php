<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Requests\StoreApplicationDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
use Modules\Drivers\Resources\DriverDocumentSlots;
use Modules\Drivers\Services\DriverApplicationService;
use Modules\Drivers\Services\DriverDocumentService;

/**
 * The KYC screen an applicant fills in before anybody has approved them
 * (ADR-0048 §4).
 *
 * **Unauthenticated, and authorised by a claim ticket rather than a session.**
 * ADR-0027 §1 gives an applicant no account at all, and that has not changed:
 * the `upload_token` minted at submission resolves to exactly one
 * `driver_applications` row and reaches nothing else on this platform — no
 * policy, no trip, no user, no other application. It is a cloakroom ticket.
 *
 * Three things this controller will not do, each of them a way the ticket
 * could otherwise become more than that:
 *
 * 1. **It never streams a file.** `index()` returns metadata and the resource
 *    sends `file_url: null` for an application-owned row. A stolen ticket must
 *    not become a way to *read* somebody's national ID — only to overwrite it,
 *    which is noisy and gains the thief nothing.
 * 2. **It never says why a ticket failed.** Unknown, expired and
 *    already-decided all answer the same 404, for the reason ADR-0027 §5
 *    gives about oracles. "This application was rejected" is not a thing to
 *    learn from an HTTP status.
 * 3. **It never reaches a driver.** Every query is scoped to the application
 *    the ticket resolved to, and `DriverDocumentService` writes
 *    `driver_application_id` for this owner and nulls `driver_id`.
 *
 * Throttled at the route, at ADR-0027 §5's 5/min/IP.
 */
class ApplicationDocumentController extends Controller
{
    public function __construct(
        private readonly DriverApplicationService $applications,
        private readonly DriverDocumentService $documents,
    ) {}

    /**
     * The six slots and what the applicant has sent so far.
     *
     * The same shape the driver app's own Documents screen reads
     * (`DriverDocumentSlots`), so the KYC screen is one screen rather than
     * two that drifted: an applicant filling it in before approval and a
     * driver filling it in after are doing the same thing.
     */
    public function index(Request $request): JsonResponse
    {
        $application = $this->resolve($request);

        if ($application === null) {
            return $this->unmatched();
        }

        return ApiResponse::success(
            DriverDocumentSlots::toArray(
                $this->documents->forApplication($application),
                $this->documents->timezone(),
                $request,
            ),
            'Documents retrieved.',
        );
    }

    /**
     * Upload, or replace what the applicant already sent of that type.
     *
     * One request per file rather than the whole set with the application,
     * and ADR-0048 §4 argues the trade: six photographs at 8 MB is a 48 MB
     * request from a handset on a Ugandan mobile connection, and when it fails
     * at 80% the applicant loses the form as well as the files.
     */
    public function store(StoreApplicationDocumentRequest $request): JsonResponse
    {
        $application = $this->resolve($request);

        if ($application === null) {
            return $this->unmatched();
        }

        $type = DriverDocumentType::from((string) $request->validated('type'));

        /** @var UploadedFile $file */
        $file = $request->file('file');

        $expiresAt = $request->validated('expires_at');

        $document = $this->documents->upload(
            $application,
            $type,
            $file,
            is_string($expiresAt) && $expiresAt !== '' ? $expiresAt : null,
        );

        return ApiResponse::success(
            (new DriverDocumentResource($document->fresh() ?? $document, $this->documents->timezone()))
                ->toArray($request),
            'Document received.',
            201,
        );
    }

    /**
     * Withdraw one, before anybody has decided.
     *
     * Here because an applicant who photographs the wrong side of a logbook
     * can otherwise only fix it by uploading over it — which works, and does
     * not help the person who realises they sent a document they did not mean
     * to send at all. The file is destroyed, not merely unlinked; the same
     * reasoning ADR-0048 §5 applies to a rejection.
     */
    public function destroy(Request $request, string $type): JsonResponse
    {
        $application = $this->resolve($request);

        if ($application === null) {
            return $this->unmatched();
        }

        $documentType = DriverDocumentType::tryFrom($type);

        if ($documentType === null) {
            return ApiResponse::error(ErrorCode::NOT_FOUND, 'No such document.', [], 404);
        }

        $document = DriverDocument::query()
            ->where('driver_application_id', $application->getKey())
            ->where('type', $documentType->value)
            ->first();

        if ($document === null) {
            // Nothing held of that type is the state the caller asked for,
            // so this is not an error. A 404 here would make a screen that
            // retried a withdrawal look broken.
            return ApiResponse::success(message: 'Nothing to withdraw.', status: 204);
        }

        $this->documents->discardOne($document);

        return ApiResponse::success(message: 'Document withdrawn.', status: 204);
    }

    /**
     * The ticket, read from the body or the `X-Upload-Token` header.
     *
     * Both, because `DELETE` has no body worth speaking of and a query string
     * is the one place a secret must not go — query strings are written to
     * access logs, proxy logs and browser history as a matter of course, and
     * this one is a live credential for somebody's identity documents.
     */
    private function resolve(Request $request): ?DriverApplication
    {
        $token = $request->input('upload_token') ?? $request->header('X-Upload-Token');

        return $this->applications->findByUploadToken(is_string($token) ? $token : null);
    }

    /**
     * One answer for unknown, expired and already-decided (ADR-0048 §4).
     *
     * 404 rather than 401, deliberately. A 401 would be an invitation to
     * retry with a better guess; more importantly, distinguishing "no such
     * ticket" from "that ticket is spent" tells an unauthenticated caller
     * that an application exists for the ticket they hold.
     */
    private function unmatched(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_FOUND,
            'This upload could not be matched to an open application. '
            .'If you have already been approved, sign in and send it from your profile.',
            [],
            404,
        );
    }
}
