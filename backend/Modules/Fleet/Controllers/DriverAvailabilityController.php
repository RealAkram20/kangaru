<?php

namespace Modules\Fleet\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Requests\StoreDriverAvailabilityRequest;
use Modules\Fleet\Resources\AvailabilityBlockResource;

/**
 * A driver's own requests for time off — the Driver's Application's half of
 * ADR-0017 §6.
 *
 * The office side has existed since ADR-0017: it records a block directly
 * and answers requests at `POST /availability-blocks/{id}/answer`. What was
 * never built is the asking. `POST /availability-blocks` needs
 * `drivers.manage`, which the driver role does not hold and must not — that
 * permission also lets you edit anybody's profile.
 *
 * ## Its own routes, not a relaxed policy on the shared ones
 *
 * Loosening `AvailabilityBlockPolicy::createFor` to admit a driver would
 * have meant the shared endpoint accepting `resource_id` and `status` from
 * a caller who must control neither, guarded by validation. These routes
 * take neither field at all: the block is pinned to the caller's own driver
 * profile, in the `requested` state, by this controller. A driver cannot
 * ask for somebody else's leave because there is nowhere to say whose.
 *
 * `/me/` rather than `/drivers/{id}/`, for the same reason: an id in the
 * path is a thing to tamper with.
 */
class DriverAvailabilityController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $this->authorize('requestOwn', AvailabilityBlock::class);

        $requests = AvailabilityBlock::query()
            ->forResource(AvailabilityResource::DRIVER, $driver->id)
            // Newest first: the app shows "what did I ask for and what did
            // they say", and the answer somebody is waiting on is the most
            // recent one.
            ->orderByDesc('starts_at')
            ->limit(50)
            ->get();

        return ApiResponse::success(AvailabilityBlockResource::collection($requests));
    }

    public function store(StoreDriverAvailabilityRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $this->authorize('requestOwn', AvailabilityBlock::class);

        /** @var User $user */
        $user = $request->user();

        $block = AvailabilityBlock::create([
            ...$request->validated(),
            // Not from the request body, and that is the whole design.
            'resource_type' => AvailabilityResource::DRIVER,
            'resource_id' => $driver->id,
            // Asking is not being granted (ADR-0017 §6). Only `approved`
            // withholds a driver from dispatch, and only the office writes
            // it — otherwise anybody could leave the roster by asking.
            'status' => AvailabilityStatus::REQUESTED,
            'created_by_user_id' => $user->id,
        ]);

        return ApiResponse::success(
            new AvailabilityBlockResource($block->refresh()),
            'Sent to the office. You are still on the roster until they answer.',
            201,
        );
    }

    /**
     * Withdraws a request the office has not answered yet.
     *
     * Only while it is unanswered. Once somebody has approved or declined
     * it, the row is the record of a decision — and a driver deleting an
     * approval they no longer want would silently put themselves back on
     * the roster without anybody knowing.
     */
    public function destroy(Request $request, AvailabilityBlock $availabilityBlock): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        // 404, not 403: another driver's request is not theirs to know
        // exists (AGENTS.md — cross-tenant reads answer 404, and the same
        // reasoning covers another person's rows).
        if ($availabilityBlock->resource_type !== AvailabilityResource::DRIVER
            || $availabilityBlock->resource_id !== $driver->id) {
            return ApiResponse::error(ErrorCode::NOT_FOUND, 'No such request.', [], 404);
        }

        if ($availabilityBlock->isAnswered()) {
            return ApiResponse::error(
                ErrorCode::AVAILABILITY_ALREADY_ANSWERED,
                sprintf(
                    'The office already %s this. Talk to them if it needs to change.',
                    $availabilityBlock->status->value,
                ),
                [],
                409,
            );
        }

        $availabilityBlock->delete();

        return ApiResponse::success(message: 'Withdrawn.', status: 204);
    }

    /**
     * The caller's own driver profile, or null when their account is not
     * linked to one (ADR-0016).
     */
    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    /**
     * A staff account with no driver profile behind it.
     *
     * 403 with a code the app can branch on, rather than a 404 that would
     * read as "this feature does not exist". An operations manager opening
     * the driver app is a support question, not a bug.
     */
    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile, so it has no roster to ask about.',
            [],
            403,
        );
    }
}
