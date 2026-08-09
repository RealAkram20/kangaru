<?php

namespace Modules\Dispatch\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Dispatch\Resources\DispatchOfferResource;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Dispatch\Services\OfferHasNoVehicleException;
use Modules\Dispatch\Services\OfferNoLongerOpenException;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Resources\TripResource;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\VehicleUnavailableException;

/**
 * The driver's side of automatic dispatch (ADR-0024 §3).
 *
 * `/me/offers`, not `/offers/{id}` with a policy, for the reason
 * `DriverAvailabilityController` and `DriverPresenceController` use the same
 * prefix: the driver is the token, and every query starts from their own
 * driver profile. An offer belonging to somebody else does not resolve, so
 * there is no "may this driver answer that offer" question left for a policy
 * to get wrong.
 *
 * ## Why the list matters as much as the push
 *
 * ADR-0025 §3 makes push best-effort and never the only path: a driver can
 * refuse the OS permission, a token can go stale, and ADR-0023's whole
 * thesis is that this app runs in dead zones. `GET /me/offers` is the source
 * of truth, and it is what the app's existing poll reads. Push shortens the
 * latency; it is not the transport.
 */
class DriverOfferController extends Controller
{
    public function __construct(private readonly DispatchOfferService $offers) {}

    public function index(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        return ApiResponse::success(
            DispatchOfferResource::collection($this->offers->openFor($driver)),
        );
    }

    /**
     * Takes the job.
     *
     * 201 with the Trip, because that is what was created — and the driver's
     * app moves straight to a trip screen rather than making a second
     * request to find out what it just accepted.
     */
    public function accept(Request $request, int $offer): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $found = $this->ownOffer($driver, $offer);

        if ($found === null) {
            return $this->noSuchOffer();
        }

        /** @var User $user */
        $user = $request->user();

        try {
            $trip = $this->offers->accept($found, $user);
        } catch (OfferNoLongerOpenException $e) {
            // The expected loss, not an error state: the clock ran out, or
            // another driver was faster. 409 for the reason
            // `DispatchController` gives about all of its conflicts — the
            // request was valid, the world moved underneath it.
            return ApiResponse::error(ErrorCode::OFFER_NO_LONGER_OPEN, $e->getMessage(), [], 409);
        } catch (OfferHasNoVehicleException $e) {
            return ApiResponse::error(ErrorCode::OFFER_HAS_NO_VEHICLE, $e->getMessage(), [], 409);
        } catch (VehicleUnavailableException $e) {
            // `TripAssignmentGuard` refused inside the transaction: a
            // dispatcher committed this van to something else in the seconds
            // the offer was out. The whole accept rolled back, so the driver
            // is told plainly rather than holding an accepted offer for a
            // trip that does not exist.
            return ApiResponse::error(ErrorCode::VEHICLE_UNAVAILABLE, $e->getMessage(), [], 409);
        } catch (DriverUnavailableException $e) {
            return ApiResponse::error(ErrorCode::DRIVER_UNAVAILABLE, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new TripResource($trip->load(['vehicle', 'driver'])),
            'Job accepted. Head for the pickup.',
            201,
        );
    }

    /**
     * Says no, and moves the search on immediately.
     *
     * 200 rather than 204: the body carries nothing useful, but a driver who
     * declines is entitled to know it registered, and an empty response over
     * a bad connection is indistinguishable from a request that never
     * arrived.
     */
    public function decline(Request $request, int $offer): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $found = $this->ownOffer($driver, $offer);

        if ($found === null) {
            return $this->noSuchOffer();
        }

        $this->offers->decline($found, $request->string('reason')->value() ?: null);

        return ApiResponse::success(message: 'Declined. The job has gone to somebody else.');
    }

    /**
     * This driver's offer, by id, or null.
     *
     * A scoped lookup rather than route-model binding, matching
     * `CustomerOrderRequestController`: the route parameter stays an integer
     * on purpose, so another driver's offer id 404s here instead of
     * resolving and then needing a policy to refuse it with a 403 that
     * confirms it exists.
     *
     * Deliberately **not** filtered to live offers. A driver answering an
     * offer that expired thirty seconds ago should be told the job is gone
     * (409), not that it never existed (404) — the second reads as a bug in
     * the app, and it is the answer they would get every time they came out
     * of a dead zone.
     */
    private function ownOffer(Driver $driver, int $offerId): ?DispatchOffer
    {
        return DispatchOffer::query()
            ->where('driver_id', $driver->id)
            ->with('orderRequest')
            ->find($offerId);
    }

    /** @see DriverAvailabilityController::driverFor() — same rule, same reason. */
    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    private function noSuchOffer(): JsonResponse
    {
        return ApiResponse::error(ErrorCode::NOT_FOUND, 'No such job.', [], 404);
    }

    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile, so no jobs are offered to it.',
            [],
            403,
        );
    }
}