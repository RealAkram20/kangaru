<?php

namespace Modules\Customers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Bookings\Models\OrderRequest;
use Modules\Customers\Resources\CustomerOrderRequestResource;

/**
 * A customer's own order requests (ADR-0013 §4) — the status checker
 * ADR-0012 deferred, delivered without the enumeration surface it
 * deferred it over.
 *
 * No policy class: the scope IS the authorization. Every query starts
 * from the token's customer_id, so there is no "may this customer see
 * that row" question left to ask — a row outside the scope does not
 * resolve, and show answers 404 rather than 403 because "there is a row
 * you may not see" is itself information (the same reasoning as
 * suspended accounts answering like wrong passwords).
 */
class CustomerOrderRequestController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user('customer');

        $page = OrderRequest::query()
            ->where('customer_id', $customer->id)
            ->latest()
            ->paginate(25);

        return ApiResponse::success(
            ['order_requests' => CustomerOrderRequestResource::collection($page->items())],
            'Your order requests.',
            200,
            [
                'page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        );
    }

    public function show(Request $request, int $orderRequest): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user('customer');

        // Scoped lookup, not model binding: the route parameter stays an
        // id on purpose, so an id outside this customer's rows 404s here
        // instead of resolving and then needing a policy to refuse it.
        $found = OrderRequest::query()
            ->where('customer_id', $customer->id)
            ->find($orderRequest);

        if ($found === null) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'The requested resource could not be found.',
                [],
                404,
            );
        }

        return ApiResponse::success(
            ['order_request' => new CustomerOrderRequestResource($found)],
            'Order request retrieved.',
        );
    }
}
