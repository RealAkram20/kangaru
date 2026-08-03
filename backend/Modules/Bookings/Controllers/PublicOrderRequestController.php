<?php

namespace Modules\Bookings\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Bookings\Models\OrderRequest;
use Modules\Bookings\Requests\StorePublicOrderRequest;
use Modules\Bookings\Services\OrderRequestService;

/**
 * The one unauthenticated write in the platform (ADR-0012 §3). Throttled at
 * the route (3/min/IP), honeypotted here, and it returns nothing but the
 * reference — no id, no echo of the stored row, nothing enumerable.
 */
class PublicOrderRequestController extends Controller
{
    public function __construct(private readonly OrderRequestService $orderRequests) {}

    public function store(StorePublicOrderRequest $request): JsonResponse
    {
        // The honeypot: a field no human sees. A bot that filled it gets a
        // convincing success and a real-looking reference, and we store
        // nothing — a bot that believes it succeeded stops probing, where a
        // 422 teaches it which field to drop (ADR-0012 §3).
        if ($request->filled('website')) {
            return ApiResponse::success(
                ['reference' => OrderRequest::mintReference()],
                'Thank you! A dispatcher will call you shortly to confirm.',
                201,
            );
        }

        $orderRequest = $this->orderRequests->receive($request->validated());

        return ApiResponse::success(
            ['reference' => $orderRequest->reference],
            'Thank you! A dispatcher will call you shortly to confirm.',
            201,
        );
    }
}
