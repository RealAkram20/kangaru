<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverPromotionService;

/**
 * What the platform is currently offering this driver — the Promotions screen
 * (ADR-0036, ADR-0037).
 *
 * Under `/me` like every other driver-scoped read on this platform, and for
 * `DriverEarningsController`'s reason: **the driver is the token.** There is no
 * id in the path and therefore no cross-driver read to authorise. That matters
 * more here than on the neighbouring endpoints, because the payload contains a
 * referral code — a credential of sorts, in that anybody holding it can
 * attribute recruits to its owner — and a `drivers/{driver}/promotions`
 * variant would need a policy the moment it existed.
 *
 * **It is deliberately not folded into `me/stats`**, which the home screen
 * polls every sixty seconds. Three settings reads, a trip count over a week and
 * a referral scan should not ride along on a poll nobody opened this screen
 * for. Same argument that separated `me/earnings` and `me/profile` from it.
 *
 * Read-only, and there is no counterpart write. A driver cannot switch a
 * scheme on, change a target or claim a reward: every one of those is the
 * office's, and the rewards are written by the rules rather than by a request.
 */
class DriverPromotionController extends Controller
{
    public function __construct(private readonly DriverPromotionService $promotions) {}

    public function index(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $driver = Driver::query()->where('user_id', $user->id)->first();

        if ($driver === null) {
            return ApiResponse::error(
                ErrorCode::NOT_A_DRIVER,
                'This account is not linked to a driver profile.',
                [],
                403,
            );
        }

        return ApiResponse::success(
            $this->promotions->forDriver($driver),
            'Driver promotions retrieved.',
        );
    }
}
