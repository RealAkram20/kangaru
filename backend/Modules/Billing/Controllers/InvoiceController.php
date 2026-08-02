<?php

namespace Modules\Billing\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Repositories\InvoiceRepository;
use Modules\Billing\Requests\GenerateInvoiceRequest;
use Modules\Billing\Requests\InvoiceIndexRequest;
use Modules\Billing\Resources\InvoiceResource;
use Modules\Billing\Services\IdempotencyKeyReusedException;
use Modules\Billing\Services\InvoiceAlreadyIssuedException;
use Modules\Billing\Services\InvoiceService;
use Modules\Billing\Services\TripNotInvoiceableException;
use Modules\Trips\Models\Trip;

/**
 * Every way invoice generation can be refused gets its own machine-readable
 * `code`, per AGENTS.md's rule that clients branch on `code` and never on
 * message text. The distinction matters here more than most places: a
 * finance user seeing TRIP_ALREADY_INVOICED should be shown the existing
 * invoice, one seeing RATE_CARD_NOT_CONFIGURED should be sent to the rate
 * card screen, and one seeing TRIP_NOT_INVOICEABLE should be told to finish
 * the trip. Three different next actions behind one generic 409 would be
 * useless.
 */
class InvoiceController extends Controller
{
    public function __construct(
        private readonly InvoiceService $invoices,
        private readonly InvoiceRepository $repository,
    ) {}

    public function index(InvoiceIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', Invoice::class);

        /** @var User $user */
        $user = $request->user();

        // Cursor pagination: invoices are append-only and grow without
        // bound, which is exactly the case AGENTS.md reserves cursors for.
        $paginator = $this->repository->listing($request->filters(), $user)->cursorPaginate(25);

        return ApiResponse::success(
            InvoiceResource::collection($paginator->getCollection()),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }

    public function show(Invoice $invoice): JsonResponse
    {
        $this->authorize('view', $invoice);

        return ApiResponse::success(
            new InvoiceResource($invoice->load(['lines', 'creditNotes.lines'])),
        );
    }

    /**
     * Issues the invoice for a completed trip.
     *
     * Returns 201 for a new invoice and 200 for a replay of the same
     * idempotency key — same body either way, so a client that only reads
     * the body cannot tell the difference and does not need to, while one
     * that watches the status can distinguish "billed" from "already
     * billed" without a second request.
     */
    public function store(GenerateInvoiceRequest $request, Trip $trip): JsonResponse
    {
        $this->authorize('create', Invoice::class);

        /** @var User $user */
        $user = $request->user();

        $rateCardId = $request->validated('rate_card_id');
        // sole() rather than findOrFail(): findOrFail's return type widens to
        // a Collection when handed an array, so the narrower call is what
        // keeps this a RateCard. GenerateInvoiceRequest has already proved
        // the id belongs to the caller's tenant and is active.
        $rateCard = $rateCardId === null
            ? null
            : RateCard::query()->whereKey($rateCardId)->sole();

        try {
            $invoice = $this->invoices->generateForTrip(
                $trip,
                $request->idempotencyKey(),
                $user,
                $rateCard,
            );
        } catch (TripNotInvoiceableException $e) {
            return ApiResponse::error(ErrorCode::TRIP_NOT_INVOICEABLE, $e->getMessage(), [], 409);
        } catch (InvoiceAlreadyIssuedException $e) {
            return ApiResponse::error(ErrorCode::TRIP_ALREADY_INVOICED, $e->getMessage(), [], 409);
        } catch (IdempotencyKeyReusedException $e) {
            return ApiResponse::error(ErrorCode::IDEMPOTENCY_KEY_REUSED, $e->getMessage(), [], 409);
        } catch (RateCardNotConfiguredException $e) {
            // 422, not 409: nothing conflicts, the request simply cannot be
            // priced until somebody sets up a rate card.
            return ApiResponse::error(ErrorCode::RATE_CARD_NOT_CONFIGURED, $e->getMessage(), [], 422);
        }

        $isReplay = ! $invoice->wasRecentlyCreated;

        return ApiResponse::success(
            new InvoiceResource($invoice),
            $isReplay ? 'Invoice already issued for this trip.' : 'Invoice generated.',
            $isReplay ? 200 : 201,
        );
    }
}
