<?php

namespace Modules\Dispatch\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\InvalidBookingTransitionException;
use Modules\Dispatch\Requests\AssignBookingRequest;
use Modules\Dispatch\Resources\CandidateVehicleResource;
use Modules\Dispatch\Services\AllocationExclusiveException;
use Modules\Dispatch\Services\AllocationOverrideRequiredException;
use Modules\Dispatch\Services\DispatchService;
use Modules\Dispatch\Services\VehicleCandidates;
use Modules\Trips\Resources\TripResource;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\VehicleUnavailableException;

class DispatchController extends Controller
{
    public function __construct(
        private readonly DispatchService $dispatch,
        private readonly VehicleCandidates $candidates,
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
        }

        return ApiResponse::success(
            new TripResource($trip->load(['vehicle', 'driver'])),
            'Booking dispatched.',
            201
        );
    }
}
