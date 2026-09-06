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
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Requests\StoreDriverDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
use Modules\Drivers\Resources\DriverDocumentSlots;
use Modules\Drivers\Services\DriverDocumentService;

/**
 * An applicant's own application, while they wait (ADR-0057 §5).
 *
 * ## Why this exists beside the claim-ticket controller
 *
 * `ApplicationDocumentController` serves the same six slots to somebody
 * holding a 64-character ticket and no account. This one serves them to
 * somebody **signed in**, because since ADR-0057 §5 an applicant has an
 * account from the moment they apply.
 *
 * That is not duplication for its own sake — it is the difference between a
 * credential that travels in an email and one that does not. The ticket path
 * stays for the applicants who never got an account: a duplicate email
 * (ADR-0027 §5 requires the endpoint to answer identically, so no user is
 * minted for a taken address) and everybody who applied before this shipped.
 *
 * ## The subject is the token, and there is no id anywhere
 *
 * Every method resolves the application from `$request->user()`, so there is
 * nothing in a path or a body that names whose application to act on. A
 * caller cannot ask for somebody else's by changing a number, which is the
 * property that makes this safe without a policy: **the question "may I?"
 * cannot be asked, because the parameter to get wrong does not exist.**
 *
 * ## Only while it is open
 *
 * A decided application answers 404 like an absent one. An approved applicant
 * is a driver and uses `/me/documents`; a refused one has nothing to send.
 * Distinguishing the two here would tell somebody their application was
 * rejected from an HTTP status, which ADR-0048 §4 already refuses for the
 * ticket path.
 */
class MyApplicationController extends Controller
{
    public function __construct(private readonly DriverDocumentService $documents) {}

    /**
     * What they sent, what the office said, and what is still owed.
     *
     * The rejection reason on a refused slot is the whole point of the
     * screen: "send your licence again" is not actionable without "the
     * bottom is cut off".
     */
    public function documents(Request $request): JsonResponse
    {
        $application = $this->openApplicationFor($request);

        if ($application === null) {
            return $this->noOpenApplication();
        }

        return ApiResponse::success(
            DriverDocumentSlots::toArray(
                $this->documents->forApplication($application),
                $this->documents->timezone(),
                $request,
            ),
            'Your documents.',
        );
    }

    /**
     * Send one again.
     *
     * Replaces whatever was held of that type, which is what makes answering
     * a refusal a single photograph rather than a fresh application.
     * `StoreDriverDocumentRequest` is the shared rule — same types, same
     * mime list, same required expiry on the types whose meaning is a date.
     */
    public function store(StoreDriverDocumentRequest $request): JsonResponse
    {
        $application = $this->openApplicationFor($request);

        if ($application === null) {
            return $this->noOpenApplication();
        }

        /** @var UploadedFile $file */
        $file = $request->file('file');
        $expiresAt = $request->validated('expires_at');

        $document = $this->documents->upload(
            $application,
            DriverDocumentType::from((string) $request->validated('type')),
            $file,
            is_string($expiresAt) && $expiresAt !== '' ? $expiresAt : null,
        );

        return ApiResponse::success(
            (new DriverDocumentResource($document->fresh() ?? $document, $this->documents->timezone()))
                ->toArray($request),
            'Sent. The office will look at it again.',
            201,
        );
    }

    /**
     * Their own open application, or null.
     *
     * `latest('id')`: ADR-0027 §5 stores a duplicate rather than refusing it,
     * so one person can hold more than one row. The newest open one is the
     * one they are being asked about.
     */
    private function openApplicationFor(Request $request): ?DriverApplication
    {
        /** @var User $user */
        $user = $request->user();

        $application = DriverApplication::query()
            ->where('user_id', $user->getKey())
            ->latest('id')
            ->first();

        return $application !== null && $application->status->isOpen() ? $application : null;
    }

    private function noOpenApplication(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_FOUND,
            'You have no application waiting. If you have been approved, your documents are on your profile.',
            [],
            404,
        );
    }
}
