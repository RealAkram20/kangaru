<?php

namespace Modules\Billing\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Requests\StoreCreditNoteRequest;
use Modules\Billing\Resources\CreditNoteResource;
use Modules\Billing\Services\CreditNoteExceedsInvoiceException;
use Modules\Billing\Services\CreditNoteService;
use Modules\Billing\Services\IdempotencyKeyReusedException;

/**
 * Nested under the invoice it corrects, because a credit note has no
 * meaning without one — there is no `/credit-notes` collection to POST to.
 */
class CreditNoteController extends Controller
{
    public function __construct(private readonly CreditNoteService $creditNotes) {}

    public function index(Invoice $invoice): JsonResponse
    {
        $this->authorize('view', $invoice);

        return ApiResponse::success(
            CreditNoteResource::collection($invoice->creditNotes()->with('lines')->get()),
        );
    }

    public function store(StoreCreditNoteRequest $request, Invoice $invoice): JsonResponse
    {
        $this->authorize('credit', $invoice);

        /** @var User $user */
        $user = $request->user();

        try {
            $note = $this->creditNotes->issue(
                $invoice,
                $request->lines(),
                (string) $request->validated('reason'),
                $request->idempotencyKey(),
                $user,
            );
        } catch (CreditNoteExceedsInvoiceException $e) {
            return ApiResponse::error(ErrorCode::CREDIT_NOTE_EXCEEDS_INVOICE, $e->getMessage(), [], 422);
        } catch (IdempotencyKeyReusedException $e) {
            return ApiResponse::error(ErrorCode::IDEMPOTENCY_KEY_REUSED, $e->getMessage(), [], 409);
        }

        $isReplay = ! $note->wasRecentlyCreated;

        return ApiResponse::success(
            new CreditNoteResource($note),
            $isReplay ? 'Credit note already issued.' : 'Credit note issued.',
            $isReplay ? 200 : 201,
        );
    }
}
