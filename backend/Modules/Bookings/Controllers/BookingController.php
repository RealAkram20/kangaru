<?php

namespace Modules\Bookings\Controllers;

use App\Enums\ErrorCode;
use App\Enums\Permission;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Requests\BookingDecisionRequest;
use Modules\Bookings\Requests\BookingIndexRequest;
use Modules\Bookings\Requests\StoreBookingRequest;
use Modules\Bookings\Resources\BookingResource;
use Modules\Bookings\Services\BookingService;
use Modules\Bookings\Services\InvalidBookingTransitionException;

class BookingController extends Controller
{
    public function __construct(private readonly BookingService $bookings) {}

    public function index(BookingIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', Booking::class);

        /** @var User $user */
        $user = $request->user();

        // `forActor` decides *whose* bookings are in range — one client's for
        // a client's user, every client's for Shanitah's own staff, who
        // belong to no tenant (ADR-0006). The permission check below decides
        // what they may see of them, and the two are deliberately separate:
        // a platform Dispatcher needs the whole cross-client queue, because
        // a matcher that can only see one client's demand is not matching.
        $query = Booking::forActor($user)->with(['requestedBy', 'approvedBy']);

        // Eager-loaded, never lazy: this is a list, and reading the client
        // off each row without it is the N+1 AGENTS.md forbids. Only for a
        // platform reader — a client's own queue is one client's, and
        // joining to tell them their own name is a query for nothing.
        if ($user->isPlatformLevel()) {
            $query->with('tenant');
        }

        // A Corporate Employee sees only what they raised — mirrors the way
        // TripController narrows a Driver to their own trips.
        // The listing counterpart of BookingPolicy::view. Anyone without
        // `bookings.view.all` sees what they raised — which is what "a
        // Corporate Employee sees only their own" meant before roles became
        // data (ADR-0004), and now holds for any custom role too.
        if (! $user->hasPermission(Permission::BOOKINGS_VIEW_ALL)) {
            $query->where('requested_by_user_id', $user->id);
        }

        $query
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when(
                $request->boolean('dispatchable'),
                fn ($q) => $q->whereIn('status', [BookingStatus::PENDING->value, BookingStatus::APPROVED->value])
            )
            // Soonest scheduled pickup first, immediate bookings ahead of
            // them — a dispatch queue ordered by creation time would bury
            // an urgent "now" request behind next week's airport runs.
            ->orderByRaw('scheduled_for IS NULL DESC')
            ->orderBy('scheduled_for')
            ->orderBy('id');

        $paginator = $query->cursorPaginate(25);

        return ApiResponse::success(
            BookingResource::collection($paginator->getCollection()),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // Whether this queue spans clients or is one client's.
                // Served the way /audit-logs already serves it, so the
                // client holds no copy of the rule: a UI that decided for
                // itself whether to show a client column would be a fourth
                // place ADR-0006's predicate lives.
                'scope' => $user->isPlatformLevel() ? 'platform' : 'tenant',
            ],
        );
    }

    public function show(Booking $booking): JsonResponse
    {
        $this->authorize('view', $booking);

        return ApiResponse::success(
            new BookingResource($booking->load(['requestedBy', 'approvedBy', 'trip.vehicle', 'trip.driver']))
        );
    }

    public function store(StoreBookingRequest $request): JsonResponse
    {
        $this->authorize('create', Booking::class);

        /** @var User $user */
        $user = $request->user();

        $booking = $this->bookings->create($request->validated(), $user);

        return ApiResponse::success(
            new BookingResource($booking->load('requestedBy')),
            'Booking created.',
            201
        );
    }

    public function approve(Booking $booking): JsonResponse
    {
        $this->authorize('approve', $booking);

        /** @var User $user */
        $user = request()->user();

        return $this->decided(fn () => $this->bookings->approve($booking, $user), 'Booking approved.');
    }

    public function reject(BookingDecisionRequest $request, Booking $booking): JsonResponse
    {
        $this->authorize('reject', $booking);

        /** @var User $user */
        $user = $request->user();

        return $this->decided(
            fn () => $this->bookings->reject($booking, $user, $request->validated('reason')),
            'Booking rejected.'
        );
    }

    public function cancel(BookingDecisionRequest $request, Booking $booking): JsonResponse
    {
        $this->authorize('cancel', $booking);

        /** @var User $user */
        $user = $request->user();

        return $this->decided(
            fn () => $this->bookings->cancel($booking, $user, $request->validated('reason')),
            'Booking cancelled.'
        );
    }

    /**
     * @param  callable(): Booking  $decision
     */
    private function decided(callable $decision, string $message): JsonResponse
    {
        try {
            $booking = $decision();
        } catch (InvalidBookingTransitionException $e) {
            return ApiResponse::error(ErrorCode::INVALID_BOOKING_TRANSITION, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(new BookingResource($booking), $message);
    }
}
