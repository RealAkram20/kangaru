<?php

namespace Modules\Bookings\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Services\SettingsService;
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
    public function __construct(
        private readonly OrderRequestService $orderRequests,
        private readonly SettingsService $settings,
    ) {}

    public function store(StorePublicOrderRequest $request): JsonResponse
    {
        // ADR-0014 phase 2: the owner's intake switch. Checked before the
        // honeypot on purpose — a paused desk answers honestly to
        // everyone; there is nothing here worth teaching a bot about.
        if ($this->settings->get('ordering', 'walk_in_enabled') !== true) {
            return ApiResponse::error(
                ErrorCode::ORDERING_PAUSED,
                'We are not taking online orders right now. Please call the dispatch desk directly.',
                [],
                503,
            );
        }

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

        // ADR-0013 §4: the route stays unauthenticated, but a customer
        // token *may* accompany the request, and then the order links to
        // the account. Resolved through the customer guard specifically —
        // a staff token here resolves to nothing and stamps nothing.
        $customer = $request->user('customer');

        $orderRequest = $this->orderRequests->receive([
            ...$request->validated(),
            'customer_id' => $customer?->id,
        ]);

        return ApiResponse::success(
            ['reference' => $orderRequest->reference],
            'Thank you! A dispatcher will call you shortly to confirm.',
            201,
        );
    }
}
