<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Requests\RejectDriverDocumentRequest;
use Modules\Drivers\Resources\DriverDocumentResource;
use Modules\Drivers\Resources\DriverDocumentSlots;
use Modules\Drivers\Services\DriverApplicationService;
use Modules\Drivers\Services\DriverDocumentService;
use Modules\Notifications\Notifications\ApplicationDocumentRejectedNotification;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The office side of an *applicant's* papers.
 *
 * ## Why this exists at all
 *
 * ADR-0048 §4 let an applicant send six documents against a claim ticket
 * before they have any account. Nothing served them back to the people who
 * decide. `DriverApplicationResource` returns a name, a phone number and a
 * status, and the queue offers Approve and Reject over it — so the decision
 * about whether somebody may drive was being taken without their licence
 * being visible anywhere in the platform.
 *
 * ## Deliberately a mirror of `DriverDocumentReviewController`
 *
 * Same service, same presenter, same shape on the wire. An applicant's
 * uploads are ordinary `driver_documents` rows with `driver_application_id`
 * set and `driver_id` null, so the only thing that differs is which column
 * the owner hangs off — which `DriverDocumentService::forApplication()`
 * already knew how to do for the driver-facing KYC screen.
 *
 * ## Verify and reject, added by ADR-0057
 *
 * This class shipped read-only, on the reasoning that a per-document verdict
 * before approval would be *"a second, quieter way to reject somebody"*. That
 * held while an applicant could neither hear a verdict nor answer one. It
 * produced a reviewer who either approved a person whose licence they could
 * not read, or refused somebody over one blurry photograph and destroyed the
 * five good documents with them.
 *
 * ADR-0057 answers the objection rather than waving it away: refusing a
 * document **does not close the application**, the reason is recorded on the
 * row like any other review, and the applicant is emailed a fresh claim
 * ticket so the refusal is answerable. Approval is then blocked until every
 * document sent has been accepted, so nothing is decided past the evidence.
 */
class ApplicationDocumentReviewController extends Controller
{
    public function __construct(
        private readonly DriverDocumentService $documents,
        private readonly DriverApplicationService $applications,
    ) {}

    /**
     * One applicant's documents, every type, held or not.
     *
     * The empty slots are as much of the answer as the full ones: a reviewer
     * asking "can I decide this yet" is asking what is missing.
     */
    public function index(Request $request, DriverApplication $driverApplication): JsonResponse
    {
        // The application, not the document class. Whoever may read the
        // application may read what was attached to it, and gating on a
        // second permission would let the queue list an application whose
        // papers it then refused to show.
        $this->authorize('view', $driverApplication);

        return ApiResponse::success(
            DriverDocumentSlots::toArray(
                $this->documents->forApplication($driverApplication),
                $this->documents->timezone(),
                $request,
            ),
            'Application documents retrieved.',
        );
    }

    /**
     * The file itself, decrypted on the way out (ADR-0053).
     */
    public function file(
        DriverApplication $driverApplication,
        DriverDocument $document,
    ): StreamedResponse|JsonResponse {
        $this->authorize('view', $driverApplication);

        /*
         * **The one line in this controller where a mistake shows somebody
         * their neighbour's passport.**
         *
         * The reviewer's permission is held over every application, so the
         * policy above says yes to any pair of ids. Without this check, a
         * valid application id and *any* document id serves that document —
         * and identity documents are exactly what is in this table.
         *
         * A 404 rather than a 403, copied from the driver-side controller for
         * the same reason: the resource named by *this* path does not exist,
         * and answering 403 would confirm that the document id does.
         */
        if (($guard = $this->refuseForeign($driverApplication, $document)) !== null) {
            return $guard;
        }

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

    /**
     * This one is good (ADR-0057 §1).
     *
     * Written through `DriverDocumentService` rather than onto the row, so
     * there is exactly one thing in the platform that records a review —
     * the property ADR-0033 §4 depends on.
     */
    public function verify(Request $request, DriverApplication $driverApplication, DriverDocument $document): JsonResponse
    {
        $this->authorize('decide', DriverApplication::class);

        if (($guard = $this->refuseForeign($driverApplication, $document)) !== null) {
            return $guard;
        }

        /** @var User $reviewer */
        $reviewer = $request->user();

        $document = $this->documents->verify($document, $reviewer);

        return ApiResponse::success(
            (new DriverDocumentResource($document, $this->documents->timezone()))->toArray($request),
            'Document accepted.',
        );
    }

    /**
     * Send this one again (ADR-0057 §1 and §3).
     *
     * **The application stays open.** That is the whole feature: five good
     * documents and a place in the queue survive one bad photograph.
     *
     * The ticket is reissued and the applicant emailed inside the same
     * transaction as the verdict. A refusal recorded without the way to
     * answer it is the dead end this change exists to remove, and a reviewer
     * has no way to notice that half of it silently failed.
     */
    public function reject(
        RejectDriverDocumentRequest $request,
        DriverApplication $driverApplication,
        DriverDocument $document,
    ): JsonResponse {
        $this->authorize('decide', DriverApplication::class);

        if (($guard = $this->refuseForeign($driverApplication, $document)) !== null) {
            return $guard;
        }

        /** @var User $reviewer */
        $reviewer = $request->user();
        $reason = (string) $request->validated('reason');

        $document = DB::transaction(function () use ($driverApplication, $document, $reviewer, $reason) {
            $reviewed = $this->documents->reject($document, $reviewer, $reason);

            /*
                **A ticket only for an applicant who cannot sign in.**

                Since ADR-0057 §5 an account is minted at submission, so the
                usual answer is "sign in and send it again" and no credential
                leaves the building. The exceptions are the applications that
                were never given an account — a duplicate email, which
                ADR-0027 §5 requires to be indistinguishable at submission,
                and everything submitted before that shipped. Those still get
                a fresh ticket, because otherwise they have no way back in at
                all.
            */
            $ticket = $driverApplication->user_id === null
                ? $this->applications->reissueUploadToken($driverApplication)
                : null;

            Notification::route('mail', $driverApplication->email)->notify(
                ApplicationDocumentRejectedNotification::for(
                    $reviewed->type->label(),
                    $reason,
                    $ticket === null ? null : $this->resendUrl($ticket),
                ),
            );

            return $reviewed;
        });

        return ApiResponse::success(
            (new DriverDocumentResource($document, $this->documents->timezone()))->toArray($request),
            'Document refused, and the applicant has been asked to send it again.',
        );
    }

    /**
     * Where the email sends them.
     *
     * The **app's** own scheme, not the console's: the person opening this is
     * an applicant on a handset, and the console is a staff application they
     * cannot sign in to. `KycVerificationScreen` already takes a ticket and
     * renders the six slots against it.
     */
    private function resendUrl(string $ticket): string
    {
        return 'kangaruride-driver://kyc?token='.$ticket;
    }

    /**
     * The same ownership check both read routes make, in one place.
     *
     * A reviewer's permission covers every application, so the policy says
     * yes to any pair of ids. A 404 rather than a 403: the resource named by
     * *this* path does not exist, and 403 would confirm the document id does.
     */
    private function refuseForeign(
        DriverApplication $driverApplication,
        DriverDocument $document,
    ): ?JsonResponse {
        if ($document->driver_application_id === $driverApplication->getKey()) {
            return null;
        }

        return ApiResponse::error(
            ErrorCode::NOT_FOUND,
            'That document does not belong to this application.',
            [],
            404,
        );
    }
}
