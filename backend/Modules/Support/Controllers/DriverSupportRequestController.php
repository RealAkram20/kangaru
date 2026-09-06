<?php

namespace Modules\Support\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Support\Enums\SupportRequestTopic;
use Modules\Support\Models\SupportRequest;
use Modules\Support\Requests\StoreSupportRequest;
use Modules\Support\Resources\SupportRequestResource;
use Modules\Support\Services\SupportRequestService;
use Modules\Trips\Models\Trip;

/**
 * A driver's own reports (ADR-0044).
 *
 * Under `/me` like the rest of the driver surface — the driver is the token, so
 * there is no id in the path and no cross-driver read to authorise.
 *
 * **This is the first place on this platform a driver's own words reach the
 * office as a record.** Everything else they can write — a settlement note, an
 * odometer reading — is attached to a number. `topics.ts` in the driver app
 * spent a docblock explaining why that was not built; ADR-0044 is the answer.
 */
class DriverSupportRequestController extends Controller
{
    public function __construct(private readonly SupportRequestService $requests) {}

    /**
     * The driver's own reports, newest first.
     *
     * Not paginated, and bounded at fifty. A driver's reports are counted in
     * ones per month, and the screen that reads this is a short list with the
     * office's answers on it — a cursor here would be machinery for a page
     * nobody will reach. The bound is a guard against a pathological account,
     * not a page size.
     */
    public function index(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $rows = SupportRequest::query()
            ->where('driver_id', $driver->getKey())
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        return ApiResponse::success(SupportRequestResource::collection($rows));
    }

    public function store(StoreSupportRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $trip = null;
        $tripId = $request->validated('trip_id');

        if ($tripId !== null) {
            /*
             * **The trip must be this driver's own**, checked here rather than
             * in the form request, exactly as `DriverSettlementRequestController`
             * documents: `exists:trips,id` proves only that the trip is real.
             *
             * The stakes are lower than a tip — nobody is paid for a report —
             * but the leak is not: attaching a report to another driver's trip
             * would put a stranger's journey in front of the office labelled
             * with this driver's account of it, and would let somebody probe
             * which trip ids exist by watching what the office answered.
             *
             * `Trip::forDriver()` rather than a plain `where`: `TenantScope`
             * fails closed and a walk-in has no tenant, so the obvious query
             * finds nothing and this would refuse every legitimate report about
             * the work drivers actually do.
             */
            $trip = Trip::forDriver($driver)->whereKey((int) $tripId)->first();

            if ($trip === null) {
                // 404, not 403: AGENTS.md's rule that a refusal must not
                // confirm the existence of a row the caller may not see.
                return ApiResponse::error(
                    ErrorCode::NOT_FOUND,
                    'That trip is not one of yours.',
                    [],
                    404,
                );
            }
        }

        $created = $this->requests->raise(
            $driver,
            SupportRequestTopic::from((string) $request->validated('topic')),
            (string) $request->validated('body'),
            $trip,
        );

        return ApiResponse::success(
            new SupportRequestResource($created),
            // Says what will happen next, and **promises no time**. The office
            // has no SLA (ADR-0044 §5) and inventing "within 24 hours" here
            // would be the app making a commitment on somebody else's behalf.
            'Your report has been sent to the office. Their answer will appear here.',
            201,
        );
    }

    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile.',
            [],
            403,
        );
    }
}
