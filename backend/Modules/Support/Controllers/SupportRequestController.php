<?php

namespace Modules\Support\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Support\Models\SupportRequest;
use Modules\Support\Requests\AnswerSupportRequest;
use Modules\Support\Resources\SupportRequestResource;
use Modules\Support\Services\SupportRequestService;

/**
 * The office's side of driver reports (ADR-0044 §3).
 *
 * Gated on `drivers.manage` through `SupportRequestPolicy`, which records why
 * that is the same compromise ADR-0032 §5 documents for settlements and where
 * the seam is when a Support role separates from Fleet.
 *
 * **The console screen ships with these endpoints, not after them.** A queue
 * the office cannot open is the half-built loop `master-plan.md` §2 exists to
 * refuse, and this feature was built specifically because the driver-facing
 * half was pretending to have a back half.
 */
class SupportRequestController extends Controller
{
    public function __construct(private readonly SupportRequestService $requests) {}

    /**
     * The queue.
     *
     * **Oldest first**, for the reason the settlement queue is: the driver who
     * has waited longest has most earned an answer, and a newest-first queue
     * starves exactly the person it matters most to.
     *
     * Unanswered by default. `?status=answered` reads the archive, and
     * `?topic=` narrows to one of the five — a payment dispute and a lost
     * phone are answered by different people at different desks.
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', SupportRequest::class);

        $paginator = SupportRequest::query()
            ->with(['driver', 'answeredBy'])
            ->when(
                $request->filled('status'),
                fn ($query) => $query->where('status', $request->string('status')),
                fn ($query) => $query->open(),
            )
            ->when(
                $request->filled('topic'),
                fn ($query) => $query->where('topic', $request->string('topic')),
            )
            ->orderBy('created_at')
            ->orderBy('id')
            ->cursorPaginate(25);

        return ApiResponse::success(
            SupportRequestResource::collection($paginator->getCollection()),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }

    public function show(SupportRequest $supportRequest): JsonResponse
    {
        $this->authorize('view', $supportRequest);

        return ApiResponse::success(
            new SupportRequestResource($supportRequest->load(['driver', 'answeredBy'])),
        );
    }

    /**
     * The reply.
     *
     * A `POST` to a sub-path rather than a `PATCH` on a status field, the shape
     * every office decision on this platform uses (approve, reject, verify,
     * confirm, decline): an answer carries its own audit meaning, and a status
     * field would make writing to a driver look like an edit.
     */
    public function answer(AnswerSupportRequest $request, SupportRequest $supportRequest): JsonResponse
    {
        $this->authorize('answer', $supportRequest);

        /** @var User $user */
        $user = $request->user();

        $answered = $this->requests->answer(
            $supportRequest,
            $user,
            (string) $request->validated('answer'),
        );

        // Idempotent by design: a report already answered comes back unchanged
        // rather than overwritten, so a double-tap does not replace a
        // colleague's reply or send the driver a second push.
        return ApiResponse::success(
            new SupportRequestResource($answered->load(['driver', 'answeredBy'])),
            'The driver has been told.',
        );
    }
}
