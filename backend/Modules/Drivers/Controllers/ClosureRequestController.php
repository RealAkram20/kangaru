<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Enums\Permission;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Enums\ClosureRequestStatus;
use Modules\Drivers\Models\DriverClosureRequest;
use Modules\Drivers\Requests\DeclineClosureRequest;
use Modules\Drivers\Resources\DriverClosureRequestResource;
use Modules\Drivers\Services\ClosureRequestAlreadyDecidedException;
use Modules\Drivers\Services\DriverClosureService;

/**
 * The office's queue of drivers asking to leave (ADR-0043).
 *
 * **This ships with the feature rather than after it.** The completeness census
 * found four features whose backend nobody in the office could reach, and a
 * closure request nobody can answer is worse than all of them: it is somebody
 * asking to stop working, into silence.
 *
 * Gated on `drivers.manage` — the permission that already governs a driver's
 * record — through an explicit check rather than a policy, because the queue
 * endpoints act on a collection and on rows that carry no tenant of their own.
 * **The seam is the same one ADR-0032 §5 and ADR-0042 §4 both name:** if a
 * Finance or HR role ever separates from Fleet, this check moves with them.
 */
class ClosureRequestController extends Controller
{
    public function __construct(private readonly DriverClosureService $closures) {}

    public function index(Request $request): JsonResponse
    {
        $this->refuseWithoutPermission($request);

        $requests = DriverClosureRequest::query()
            ->with('driver')
            // Pending first, then newest. A queue sorted only by date buries
            // the rows that need an answer under the ones already answered.
            ->orderByRaw('CASE WHEN status = ? THEN 0 ELSE 1 END', [ClosureRequestStatus::PENDING->value])
            ->latest('id')
            ->limit(100)
            ->get();

        return ApiResponse::success(
            DriverClosureRequestResource::collection($requests)->resolve(),
            'Closure requests retrieved.',
        );
    }

    public function confirm(Request $request, DriverClosureRequest $closureRequest): JsonResponse
    {
        $this->refuseWithoutPermission($request);

        /** @var User $reviewer */
        $reviewer = $request->user();

        try {
            $confirmed = $this->closures->confirm($closureRequest, $reviewer);
        } catch (ClosureRequestAlreadyDecidedException $e) {
            return ApiResponse::error(ErrorCode::CLOSURE_REQUEST_ALREADY_DECIDED, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            ['closure_request' => new DriverClosureRequestResource($confirmed)],
            'Account closed. The driver has been emailed.',
        );
    }

    public function decline(
        DeclineClosureRequest $request,
        DriverClosureRequest $closureRequest,
    ): JsonResponse {
        $this->refuseWithoutPermission($request);

        /** @var User $reviewer */
        $reviewer = $request->user();

        try {
            $declined = $this->closures->decline($closureRequest, $reviewer, $request->validated()['reason']);
        } catch (ClosureRequestAlreadyDecidedException $e) {
            return ApiResponse::error(ErrorCode::CLOSURE_REQUEST_ALREADY_DECIDED, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            ['closure_request' => new DriverClosureRequestResource($declined)],
            'Declined. The driver has been emailed your reason.',
        );
    }

    /**
     * `abort_unless` is deliberately **not** used here.
     *
     * ADR-0032's entry recorded why and it cost three failing tests to learn:
     * `abort_unless(..., 403)` produces a framework error page rather than the
     * API envelope, and `ValidatesOpenApiContract` rejects it for a missing
     * `success` key. Raising `AuthorizationException` through `denyAs` gets
     * rendered properly.
     */
    private function refuseWithoutPermission(Request $request): void
    {
        /** @var User $user */
        $user = $request->user();

        if (! $user->hasPermission(Permission::DRIVERS_MANAGE)) {
            throw new AuthorizationException(
                'You do not have permission to answer closure requests.',
            );
        }
    }
}
