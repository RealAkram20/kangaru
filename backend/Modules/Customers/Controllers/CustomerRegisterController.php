<?php

namespace Modules\Customers\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Bookings\Resources\OrderRequestResource;
use Modules\Customers\Requests\CustomerIndexRequest;
use Modules\Customers\Requests\SuspendCustomerRequest;
use Modules\Customers\Resources\CustomerProfileResource;
use Modules\Customers\Services\CustomerAdminService;
use Modules\Customers\Services\CustomerRegistry;

/**
 * The customer register, as staff see it (ADR-0018).
 *
 * Separate from `CustomerAuthController`, which is the customer acting on
 * their own account behind the `customer` guard. These routes sit behind
 * `auth:sanctum` with the staff guard and a policy, and nothing here lets a
 * staff member act *as* a customer — no password reset, no impersonation,
 * no editing somebody else's profile. The same line `Modules/Administration`
 * draws for staff accounts, drawn again for members of the public, and for
 * a stronger reason.
 */
class CustomerRegisterController extends Controller
{
    public function __construct(
        private readonly CustomerRegistry $registry,
        private readonly CustomerAdminService $admin,
    ) {}

    public function index(CustomerIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', Customer::class);

        /** @var User $user */
        $user = $request->user();

        $page = $this->registry->paginate($request->validated(), $user);

        return ApiResponse::success(
            CustomerProfileResource::collection($page->items()),
            meta: [
                'cursor' => ['next' => $page->nextCursor()?->encode()],
                // The header's counts. Sent with the page rather than as a
                // second endpoint the screen would have to remember to call
                // — and would render a blank total while it waited.
                'tally' => $this->registry->tally(),
            ],
        );
    }

    public function show(Customer $customer): JsonResponse
    {
        $this->authorize('view', $customer);

        return ApiResponse::success(
            new CustomerProfileResource($customer->loadCount('orderRequests')),
        );
    }

    /**
     * What this customer has asked for (ADR-0018 §4).
     *
     * Its own endpoint rather than an `?include=` on the profile: a support
     * agent opens the profile to answer "who is this", and pulls the
     * history only when the question is "what happened". Loading a year of
     * orders to render a phone number is the N+1 of screens.
     */
    public function activity(Customer $customer): JsonResponse
    {
        $this->authorize('view', $customer);

        $orders = $customer->orderRequests()
            ->latest('id')
            ->limit(50)
            ->get();

        return ApiResponse::success(OrderRequestResource::collection($orders));
    }

    public function suspend(SuspendCustomerRequest $request, Customer $customer): JsonResponse
    {
        $this->authorize('suspend', $customer);

        /** @var User $user */
        $user = $request->user();

        $customer = $this->admin->suspend($customer, $request->validated()['reason'], $user);

        return ApiResponse::success(
            new CustomerProfileResource($customer),
            'Suspended. Any session they had open is now closed.',
        );
    }

    public function restore(Customer $customer): JsonResponse
    {
        $this->authorize('suspend', $customer);

        return ApiResponse::success(
            new CustomerProfileResource($this->admin->restore($customer)),
            'Restored. They can sign in again.',
        );
    }
}
