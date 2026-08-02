<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Enums\Permission;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Requests\StoreTripRequest;
use Modules\Trips\Requests\TransitionTripRequest;
use Modules\Trips\Requests\TripIndexRequest;
use Modules\Trips\Resources\TripResource;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\InvalidTripTransitionException;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Trips\Services\VehicleUnavailableException;

class TripController extends Controller
{
    public function __construct(
        private readonly TripService $trips,
        private readonly TripStateMachine $stateMachine,
    ) {}

    public function index(TripIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', Trip::class);

        /** @var User $user */
        $user = $request->user();

        // Whose trips (ADR-0006) before what may be seen of them (ADR-0004).
        // Platform staff belong to no tenant and read every client's; the
        // narrowing below still applies to them, so a platform account
        // without `trips.view.all` sees the same nothing it would inside a
        // tenant.
        $query = Trip::forActor($user)->with(['vehicle', 'driver']);

        // The listing counterpart of TripPolicy::view. Anyone without
        // `trips.view.all` sees only trips that are theirs — assigned to
        // them as a driver, or produced by a booking they raised.
        //
        // One `where` group with two `orWhereHas` branches, not two
        // separate filters: a user could legitimately be either party, and
        // chaining them would AND the conditions and return nothing.
        //
        // whereHas, not a left join on a nullable column: a trip raised
        // directly through POST /trips has no booking and must not appear
        // for a requester, and whereHas excludes it by construction.
        if (! $user->hasPermission(Permission::TRIPS_VIEW_ALL)) {
            $query->where(function ($scoped) use ($user) {
                $scoped
                    ->whereHas('driver', fn ($q) => $q->where('user_id', $user->id))
                    ->orWhereHas('booking', fn ($q) => $q->where('requested_by_user_id', $user->id));
            });
        }

        $query
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('vehicle_id'), fn ($q) => $q->where('vehicle_id', $request->integer('vehicle_id')))
            ->when($request->filled('driver_id'), fn ($q) => $q->where('driver_id', $request->integer('driver_id')))
            ->orderBy('created_at', 'desc')
            ->orderBy('id', 'desc');

        $paginator = $query->cursorPaginate(25);

        return ApiResponse::success(
            TripResource::collection($paginator->getCollection()),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }

    public function show(Trip $trip): JsonResponse
    {
        $this->authorize('view', $trip);

        return ApiResponse::success(new TripResource($trip->load(['vehicle', 'driver'])));
    }

    public function store(StoreTripRequest $request): JsonResponse
    {
        $this->authorize('create', Trip::class);

        /** @var User $user */
        $user = $request->user();

        try {
            $trip = $this->trips->create($request->validated(), $user);
        } catch (VehicleUnavailableException|DriverUnavailableException $e) {
            return ApiResponse::error($this->unavailabilityCode($e), $e->getMessage(), [], 409);
        }

        return ApiResponse::success(new TripResource($trip), 'Trip created.', 201);
    }

    public function transition(TransitionTripRequest $request, Trip $trip): JsonResponse
    {
        $to = TripStatus::from($request->validated('to'));

        $this->authorize('transition', [$trip, $to]);

        /** @var User $user */
        $user = $request->user();

        try {
            $trip = $this->stateMachine->transition($trip, $to, $user, $request->validated());
        } catch (InvalidTripTransitionException $e) {
            return ApiResponse::error(ErrorCode::INVALID_TRIP_TRANSITION, $e->getMessage(), [], 409);
        } catch (VehicleUnavailableException|DriverUnavailableException $e) {
            // Reachable on the Rejected -> Assigned reassignment path, where
            // the dispatcher may pick a vehicle or driver that has been
            // taken since the page was loaded.
            return ApiResponse::error($this->unavailabilityCode($e), $e->getMessage(), [], 409);
        }

        return ApiResponse::success(new TripResource($trip->load(['vehicle', 'driver'])), 'Trip updated.');
    }

    private function unavailabilityCode(VehicleUnavailableException|DriverUnavailableException $e): ErrorCode
    {
        return $e instanceof VehicleUnavailableException
            ? ErrorCode::VEHICLE_UNAVAILABLE
            : ErrorCode::DRIVER_UNAVAILABLE;
    }
}
