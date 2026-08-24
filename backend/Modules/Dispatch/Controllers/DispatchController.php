<?php

namespace Modules\Dispatch\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\InvalidBookingTransitionException;
use Modules\Dispatch\Requests\AssignBookingRequest;
use Modules\Dispatch\Resources\CandidateDriverResource;
use Modules\Dispatch\Resources\CandidateVehicleResource;
use Modules\Dispatch\Resources\DispatchSuggestionResource;
use Modules\Dispatch\Services\AllocationExclusiveException;
use Modules\Dispatch\Services\AllocationOverrideRequiredException;
use Modules\Dispatch\Services\BookingNotDispatchableException;
use Modules\Dispatch\Services\DispatchRecommender;
use Modules\Dispatch\Services\DispatchService;
use Modules\Dispatch\Services\DriverCandidates;
use Modules\Dispatch\Services\VehicleCandidates;
use Modules\Trips\Resources\TripResource;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\VehicleUnavailableException;

class DispatchController extends Controller
{
    public function __construct(
        private readonly DispatchService $dispatch,
        private readonly VehicleCandidates $candidates,
        private readonly DriverCandidates $driverCandidates,
        private readonly DispatchRecommender $recommender,
    ) {}

    /**
     * The platform pool ordered for this booking (ADR-0009 §1).
     *
     * Gated on the same ability as the assignment it precedes: anyone who
     * may see which vehicles are contracted here is someone who may dispatch
     * this booking, and a candidate list is a preview of that act.
     */
    public function candidates(Booking $booking): JsonResponse
    {
        $this->authorize('dispatch', $booking);

        return ApiResponse::success(
            CandidateVehicleResource::collection($this->candidates->forBooking($booking)),
        );
    }

    /**
     * The roster judged for this booking (ADR-0017).
     *
     * Same gate as the vehicle list and for the same reason: a candidate
     * list is a preview of the assignment it precedes.
     */
    public function driverCandidates(Booking $booking): JsonResponse
    {
        $this->authorize('dispatch', $booking);

        return ApiResponse::success(
            CandidateDriverResource::collection($this->driverCandidates->forBooking($booking)),
        );
    }

    /**
     * What the matcher would choose, ranked, with its reasons (ADR-0020).
     *
     * Always available, flag or no flag. A suggestion a dispatcher reads and
     * acts on is how an operator builds confidence in a matcher before it is
     * allowed to act alone, and reading one can do no harm.
     */
    public function recommendation(Booking $booking): JsonResponse
    {
        $this->authorize('dispatch', $booking);

        return ApiResponse::success(
            DispatchSuggestionResource::collection($this->recommender->forBooking($booking)),
        );
    }

    /**
     * Commits the top suggestion (ADR-0020) — behind the feature flag
     * AGENTS.md requires for dispatch algorithm changes.
     *
     * Goes through `DispatchService::assign`, exactly as the manual path
     * does, so the pessimistic locks, the allocation rules and the
     * availability refusals all still apply. A matcher with its own
     * assignment path would be a second way to write a trip, and the race
     * guarantee is only as good as its narrowest path.
     */
    public function autoAssign(Request $request, Booking $booking): JsonResponse
    {
        $this->authorize('dispatch', $booking);

        if (! config('dispatch.automatic_enabled')) {
            return ApiResponse::error(
                ErrorCode::AUTOMATIC_DISPATCH_DISABLED,
                'Automatic dispatch is switched off. Assign this booking yourself, or ask an administrator to enable it.',
                [],
                409,
            );
        }

        $suggestion = $this->recommender->bestFor($booking);

        if ($suggestion === null) {
            return ApiResponse::error(
                ErrorCode::NO_DISPATCH_CANDIDATE,
                'Nothing can take this booking right now — no vehicle and driver are both free with enough seats.',
                [],
                409,
            );
        }

        /** @var User $user */
        $user = $request->user();

        try {
            $trip = $this->dispatch->assign(
                $booking,
                $suggestion->vehicle->id,
                $suggestion->driver->id,
                $user,
            );
        } catch (VehicleUnavailableException|DriverUnavailableException $e) {
            // The world moved between ranking and committing — another
            // dispatcher took the same van. A 409 rather than silently
            // trying the second choice: picking again without saying so
            // would make the matcher unpredictable at exactly the moment
            // somebody is watching it.
            return ApiResponse::error(ErrorCode::VEHICLE_UNAVAILABLE, $e->getMessage(), [], 409);
        } catch (InvalidBookingTransitionException $e) {
            return ApiResponse::error(ErrorCode::INVALID_BOOKING_TRANSITION, $e->getMessage(), [], 409);
        } catch (BookingNotDispatchableException $e) {
            return ApiResponse::error(ErrorCode::BOOKING_NOT_DISPATCHABLE, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(new TripResource($trip), 'Assigned automatically.', 201);
    }

    /**
     * Assign a vehicle and driver to a booking, producing its Trip.
     *
     * Every failure here is a 409 rather than a 422: the request itself was
     * valid, the world simply changed underneath it. Clients branch on
     * `code` to tell the three apart (AGENTS.md API Standards).
     */
    public function store(AssignBookingRequest $request, Booking $booking): JsonResponse
    {
        $this->authorize('dispatch', $booking);

        /** @var User $user */
        $user = $request->user();

        try {
            $trip = $this->dispatch->assign(
                $booking,
                $request->integer('vehicle_id'),
                $request->integer('driver_id'),
                $user,
                $request->string('allocation_override_reason')->value() ?: null,
            );
        } catch (AllocationOverrideRequiredException $e) {
            // A 422 against the field, not a 409: nothing conflicts, the
            // request is missing something this particular choice requires.
            // Returned in the standard validation shape so the client reads
            // it the way it reads every other field error (ADR-0007's
            // lesson — a considered refusal that renders as a generic
            // failure looks like a broken page).
            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'The given data was invalid.',
                ['allocation_override_reason' => [$e->getMessage()]],
                422,
            );
        } catch (AllocationExclusiveException $e) {
            return ApiResponse::error(ErrorCode::VEHICLE_EXCLUSIVELY_ALLOCATED, $e->getMessage(), [], 409);
        } catch (VehicleUnavailableException $e) {
            return ApiResponse::error(ErrorCode::VEHICLE_UNAVAILABLE, $e->getMessage(), [], 409);
        } catch (DriverUnavailableException $e) {
            return ApiResponse::error(ErrorCode::DRIVER_UNAVAILABLE, $e->getMessage(), [], 409);
        } catch (InvalidBookingTransitionException $e) {
            return ApiResponse::error(ErrorCode::INVALID_BOOKING_TRANSITION, $e->getMessage(), [], 409);
        } catch (BookingNotDispatchableException $e) {
            // ADR-0064: the service never takes a driver. A 409, not a 422 —
            // the ids were well-formed, the booking is not that kind of work.
            return ApiResponse::error(ErrorCode::BOOKING_NOT_DISPATCHABLE, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new TripResource($trip->load(['vehicle', 'driver'])),
            'Booking dispatched.',
            201
        );
    }
}
