<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripRating;

/**
 * The passenger's verdict on a ride (ADR-0030).
 *
 * On the `customer` guard, and there is deliberately no staff equivalent: an
 * office that can score its own drivers has a rating that measures the
 * office, and the whole value of this number is that it does not.
 *
 * The trip is resolved from the customer's own rows rather than trusted from
 * the path, so "rate somebody else's ride" is not a request this endpoint can
 * express — the same shape as `CustomerRideController`.
 */
class TripRatingController extends Controller
{
    public function store(Request $request, Trip $trip): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user();

        $validated = $request->validate([
            'stars' => ['required', 'integer', Rule::in([1, 2, 3, 4, 5])],
            // For the office, not for the driver (ADR-0030 §6).
            'comment' => ['nullable', 'string', 'max:500'],
        ]);

        // You rate your own ride. A trip belonging to somebody else answers
        // 404 rather than 403: whether a given trip id exists is not a fact
        // this endpoint hands out.
        if ($trip->customer_id !== $customer->getKey()) {
            return ApiResponse::error(ErrorCode::NOT_FOUND, 'No such trip.', [], 404);
        }

        // Rating before the end rates a journey that has not happened, and
        // rating a cancelled trip punishes a driver for a decision that may
        // have been the passenger's (ADR-0030 §1).
        if ($trip->status !== TripStatus::TRIP_COMPLETED) {
            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'You can rate a ride once it has been completed.',
                [],
                422,
            );
        }

        // There is deliberately no "this trip has no driver" branch here.
        // `trips.driver_id` is NOT NULL — the migration constrains it and the
        // live schema agrees — so a trip always has somebody to rate, and a
        // guard against null was dead code that Larastan level 8 refused. If
        // driverless trips ever become a thing, that is a migration and a
        // decision, and the check comes back with them.

        // Immutable (ADR-0030 §2): an editable rating is a lever over a
        // driver. The unique index on trip_id is the real guard; this turns
        // the race into a sentence instead of an integrity violation.
        if (TripRating::query()->where('trip_id', $trip->getKey())->exists()) {
            return ApiResponse::error(
                ErrorCode::VALIDATION_FAILED,
                'You have already rated this ride. A rating cannot be changed.',
                [],
                422,
            );
        }

        $rating = TripRating::create([
            'trip_id' => $trip->getKey(),
            'customer_id' => $customer->getKey(),
            // Denormalised on purpose: reassigning the trip later must not
            // move this rating to a driver who did not earn it.
            'driver_id' => $trip->driver_id,
            'stars' => $validated['stars'],
            'comment' => $validated['comment'] ?? null,
        ]);

        return ApiResponse::success(
            ['stars' => $rating->stars],
            'Thank you — your rating has been recorded.',
            201,
        );
    }
}
