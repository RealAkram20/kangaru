<?php

namespace Modules\Notifications\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Notifications\Models\DeviceToken;
use Modules\Notifications\Requests\StoreDeviceTokenRequest;

/**
 * Where to push a notification (ADR-0025 §4).
 *
 * `/me/devices`, like every other route the driver app owns: the account is
 * the token, and there is no id in the path to tamper with.
 *
 * ## No policy class
 *
 * The scope is the authorization. Every query starts from the caller's own
 * `user_id`, so there is no "may this user register that device" question
 * left for a policy to get wrong — the same reasoning
 * `CustomerOrderRequestController` and `DriverOfferController` use.
 */
class DeviceTokenController extends Controller
{
    /**
     * Registers this install, or refreshes it.
     *
     * Idempotent by the token's unique index, which is what makes it safe for
     * the app to call on every sign-in and on every OS token rotation without
     * accumulating rows.
     *
     * **The token moves to whoever registered it last**, and that is the
     * point of the index being global rather than per user: a shared depot
     * handset signed in as one driver and then another must not be reachable
     * as both, or the first driver's job offers — with a pickup address on
     * the lock screen — land in front of whoever is holding it now.
     */
    public function store(StoreDeviceTokenRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        DeviceToken::query()->updateOrCreate(
            ['token' => $request->string('token')->value()],
            [
                'user_id' => $user->id,
                'provider' => $request->string('provider')->value() ?: 'expo',
                'platform' => $request->string('platform')->value() ?: null,
                'app_version' => $request->string('app_version')->value() ?: null,
                // Refreshed every time. A driver on duty whose device row has
                // not been seen in a week is somebody the fleet office should
                // ask about — this is what makes a silent, per-driver
                // delivery failure noticeable at all (ADR-0025 Consequences).
                'last_seen_at' => now(),
            ],
        );

        return ApiResponse::success(message: 'This device will receive job offers.', status: 204);
    }

    /**
     * Unregisters this install.
     *
     * Called on sign-out, and it matters more than it looks: a shared handset
     * that kept its previous driver's token would deliver another person's
     * job offers, pickup address included, to whoever is holding the phone.
     *
     * Scoped to the caller's own rows, so a token belonging to somebody else
     * is simply not found — and the response is the same either way, because
     * "that token exists but is not yours" is not something worth confirming.
     */
    public function destroy(Request $request, string $token): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        DeviceToken::query()
            ->where('user_id', $user->id)
            ->where('token', $token)
            ->delete();

        // 204 whether or not a row went. Deleting a registration that is
        // already gone is the outcome the caller wanted, and a 404 here would
        // make a driver's sign-out fail on a retry.
        return ApiResponse::success(message: 'This device will no longer receive job offers.', status: 204);
    }
}
