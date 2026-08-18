<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\UpdateDriverProfileRequest;
use Modules\Drivers\Services\DriverProfileService;

/**
 * Who this driver is on the platform — the Profile screen's facts.
 *
 * Under `/me` like `me/stats`, `me/earnings` and `me/trips`, and for the reason
 * `DriverStatsController` gives: **the driver is the token.** No id in the
 * path, so no policy question and no way to spell a cross-driver read.
 *
 * **Separate from `me/stats` on purpose.** Stats is polled by the home screen
 * every sixty seconds; this is opened deliberately, and carries a lifetime
 * `COUNT`, a vehicle join and a documents summary that no poll should pay for.
 * Same argument that kept `me/earnings` off `me/stats`.
 */
class DriverProfileController extends Controller
{
    public function __construct(private readonly DriverProfileService $profile) {}

    public function show(Request $request): JsonResponse
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

        return ApiResponse::success($this->profile->forDriver($driver), 'Driver profile retrieved.');
    }

    /**
     * A driver correcting their own name or phone number.
     *
     * `PATCH`, not `PUT`, and not `POST` to a sub-path: this is an edit to
     * fields on an existing record, which is exactly what the other `PATCH` in
     * this module (`drivers/{driver}`) is. The decisions in this module that
     * are `POST`-to-a-sub-path — approve, reject, verify, confirm — are all
     * acts by *somebody else* with their own audit meaning. Correcting your own
     * phone number is not one of those.
     *
     * No policy, for the reason this whole controller has none: there is no id
     * in the path, so there is no cross-driver write to spell.
     */
    public function update(UpdateDriverProfileRequest $request): JsonResponse
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
            $this->profile->update($driver, $request->validated()),
            'Profile updated.',
        );
    }
}
