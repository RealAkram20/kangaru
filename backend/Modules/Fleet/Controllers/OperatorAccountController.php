<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Operator;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Resources\UserResource;

/**
 * Who head office can act as at a fleet (ADR-0056, ADR-0059 §5).
 *
 * ## Why this exists at all, given `OperatorResource` is counts-only
 *
 * Acting as assumes **a person's identity**. There is no "act as Shanitah";
 * there is "act as Shanitah's fleet owner". So the one thing head office
 * genuinely needs from inside a fleet is a list of names to pick from — and
 * without it the Log in as button has nothing to send.
 *
 * A separate endpoint rather than a field on `OperatorResource`, because that
 * resource carries counts and no operational data on purpose (ADR-0055 §2),
 * and the easiest way to breach that line is to start adding "just one more
 * useful field" to it. Here the disclosure is explicit, separately policed
 * and separately testable.
 *
 * ## Scoped to the fleet, and gated on the register's own policy
 *
 * `viewAny` on `OperatorPolicy` — `access_level = kangaru`. A fleet's own
 * Super Admin is refused their own staff list here, which sounds odd until
 * you remember they already have `/users`, correctly scoped to them. This
 * endpoint is head office's cross-fleet read, and it is the only one.
 */
class OperatorAccountController extends Controller
{
    public function index(Operator $operator): JsonResponse
    {
        $this->authorize('view', $operator);

        $accounts = User::query()
            ->where('operator_id', $operator->id)
            // The people a support agent can plausibly be. A driver's account
            // is a fleet account too, and acting as one is read-only by
            // ADR-0056's own rule — so they are listed, not filtered out, and
            // the console says which is which.
            ->orderBy('name')
            ->get();

        return ApiResponse::success(UserResource::collection($accounts));
    }
}
