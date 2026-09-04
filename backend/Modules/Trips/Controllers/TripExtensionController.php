<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripStop;
use Modules\Trips\Requests\DeclineTripExtensionRequest;
use Modules\Trips\Requests\StoreTripStopRequest;
use Modules\Trips\Resources\TripStopResource;
use Modules\Trips\Services\TripStopService;

/**
 * The passenger going further than the drop-off they agreed to.
 *
 * ## Why this is not `TripStopController`
 *
 * They write the same table and share the same validation, and they are
 * still different acts. A stop is a pause on the way to a destination nobody
 * changed — ADR-0045 §4, flagged, shown, *never billed*. An extension moves
 * the end of the journey and the fare follows it. Serving both from one
 * endpoint would mean one authorization question, one flag rule and one
 * `unplanned_stop_count` decision covering two things that need opposite
 * answers to each.
 *
 * ## The consent split
 *
 * The driver and the office add an extension outright: they are recording a
 * decision already taken in the car. A **passenger** proposes one, and the
 * driver answers — an extension changes where a driver is going and what
 * they are owed, so it is not something a back seat may impose. The
 * proposing half lives on the customer surface, where the token's own
 * `customer_id` is the authorization; this is the half the driver answers
 * through.
 */
class TripExtensionController extends Controller
{
    public function __construct(private readonly TripStopService $stops) {}

    /**
     * The driver or the office records that the journey now goes further.
     */
    public function store(StoreTripStopRequest $request, Trip $trip): JsonResponse
    {
        $this->authorize('addStop', $trip);

        if (! in_array($trip->status, TripStopService::ACTIVE_STATUSES, true)) {
            // The same 409 as a stop and for the same reason: the request is
            // well-formed and the journey is not running. A completed trip's
            // itinerary is evidence, and evidence does not grow afterwards.
            return ApiResponse::error(
                ErrorCode::TRIP_NOT_ACTIVE,
                'A trip can only be extended while it is running.',
                [],
                409,
            );
        }

        /** @var User $user */
        $user = $request->user();

        $source = $trip->driver?->user_id === $user->id
            ? TripStopSource::ADDED_BY_DRIVER
            : TripStopSource::ADDED_BY_DISPATCH;

        $extension = $this->stops->addExtension($trip, $request->validated(), $user, $source);

        return ApiResponse::success(new TripStopResource($extension), 'Extension added.', 201);
    }

    /**
     * The driver agrees to a passenger's request.
     *
     * `acceptance` rather than `accept`, matching `me/offers/{offer}/
     * acceptance`: the driver is creating an agreement, not commanding the
     * server. The same shape a driver app already speaks for the one other
     * thing it answers.
     */
    public function accept(Request $request, Trip $trip, TripStop $extension): JsonResponse
    {
        /** @var User $user */
        $user = $this->guard($request->user(), $trip, $extension);

        return ApiResponse::success(
            new TripStopResource($this->stops->acceptExtension($trip, $extension, $user)),
            'Extension accepted.',
        );
    }

    /** The driver refuses one — recorded with a reason, never deleted. */
    public function decline(DeclineTripExtensionRequest $request, Trip $trip, TripStop $extension): JsonResponse
    {
        /** @var User $user */
        $user = $this->guard($request->user(), $trip, $extension);

        return ApiResponse::success(
            new TripStopResource(
                $this->stops->declineExtension($trip, $extension, $user, $request->validated('reason')),
            ),
            'Extension declined.',
        );
    }

    /**
     * The checks both answers share.
     *
     * The route model binding has already found a `TripStop`, and by itself
     * that proves nothing: an id from another trip, or a plain stop, or an
     * extension nobody proposed would all bind. Each is refused here in the
     * one masked sentence the routes use elsewhere — a caller learns that the
     * thing is not answerable, not which of the three reasons applies.
     */
    private function guard(?Authenticatable $user, Trip $trip, TripStop $extension): User
    {
        $this->authorize('addStop', $trip);

        // `instanceof User`, not a cast: these routes sit behind
        // `auth:sanctum`, but `$request->user()` is typed across every guard
        // the app has — a `Customer` among them — and the passenger's own
        // surface is a different route entirely. Narrowing here says so,
        // where a cast would only silence the question.
        abort_unless(
            $user instanceof User
                && $extension->trip_id === $trip->id
                && $extension->isExtension()
                && $extension->isAwaitingDriver(),
            404,
        );

        return $user;
    }
}
