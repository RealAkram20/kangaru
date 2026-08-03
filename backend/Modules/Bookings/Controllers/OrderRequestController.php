<?php

namespace Modules\Bookings\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Bookings\Requests\OrderRequestIndexRequest;
use Modules\Bookings\Requests\UpdateOrderRequestRequest;
use Modules\Bookings\Resources\OrderRequestResource;
use Modules\Bookings\Services\InvalidOrderRequestTransitionException;
use Modules\Bookings\Services\OrderRequestService;

/**
 * The dispatch desk's walk-in queue (ADR-0012 §4). Platform staff with
 * `order_requests.manage` only — OrderRequestPolicy checks both halves.
 */
class OrderRequestController extends Controller
{
    public function __construct(private readonly OrderRequestService $orderRequests) {}

    public function index(OrderRequestIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', OrderRequest::class);

        $query = OrderRequest::query()->with('handledBy');

        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }

        if ($request->filled('service_type')) {
            $query->where('service_type', $request->string('service_type'));
        }

        // Oldest first within the queue: the request that has waited
        // longest is the next phone call to make.
        $page = $query->orderBy('created_at')->paginate(25);

        return ApiResponse::success(
            ['order_requests' => OrderRequestResource::collection($page->items())],
            'Order requests retrieved.',
            200,
            [
                'page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        );
    }

    public function show(OrderRequest $orderRequest): JsonResponse
    {
        $this->authorize('view', $orderRequest);

        return ApiResponse::success(
            ['order_request' => new OrderRequestResource($orderRequest->load('handledBy'))],
            'Order request retrieved.',
        );
    }

    public function update(UpdateOrderRequestRequest $request, OrderRequest $orderRequest): JsonResponse
    {
        $this->authorize('update', $orderRequest);

        /** @var User $user */
        $user = $request->user();

        try {
            $moved = $this->orderRequests->move(
                $orderRequest,
                OrderRequestStatus::from($request->string('status')->value()),
                $user,
                $request->input('dispatcher_notes'),
            );
        } catch (InvalidOrderRequestTransitionException $e) {
            return ApiResponse::error(ErrorCode::INVALID_ORDER_REQUEST_TRANSITION, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            ['order_request' => new OrderRequestResource($moved->load('handledBy'))],
            'Order request updated.',
        );
    }
}
