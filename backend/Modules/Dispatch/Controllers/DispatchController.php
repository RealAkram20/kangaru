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
use Modules\Dispatch\Services\DispatchService;
use Modules\Trips\Resources\TripResource;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\VehicleUnavailableException;

class DispatchController extends Controller
{
    public function __construct(private readonly DispatchService $dispatch) {}

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
            );
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
