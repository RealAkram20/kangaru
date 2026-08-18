<?php

namespace Modules\Drivers\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Enums\SettlementRequestStatus;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Drivers\Resources\DriverSettlementRequestResource;
use Modules\Drivers\Services\DriverSettlementRequestService;

/**
 * The office's side of settlement requests (ADR-0032).
 *
 * **Confirming is what writes a `settlement` ledger entry** — the loop
 * ADR-0029 §6 promised the office would close and never gave it a way to.
 *
 * Gated on `drivers.manage`, the permission that already governs a driver's
 * record. **That is a compromise and ADR-0032 §5 records it as one:**
 * confirming that money moved is closer to a Finance act than a Fleet one,
 * and AGENTS.md already requires MFA for Finance because those roles "can move
 * money and change rates". A dedicated `drivers.settle` permission is the
 * right refinement, and when Finance separates from Fleet this is the seam to
 * cut along. It was not added here because it touches the permission census
 * and every role definition, and nothing about this feature depends on it.
 *
 * **There is no console screen yet.** The office can act only through these
 * endpoints, which is a smaller and more honest gap than the one it replaces:
 * before this, nothing anywhere could record a settlement at all.
 */
class SettlementRequestController extends Controller
{
    public function __construct(private readonly DriverSettlementRequestService $requests) {}

    /**
     * The queue.
     *
     * **Oldest first**, unlike every other list in this platform. A driver
     * who has been waiting three days for their money should be at the top,
     * not buried under this morning's requests — a newest-first queue starves
     * exactly the person it most matters to.
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', DriverSettlementRequest::class);

        $paginator = DriverSettlementRequest::query()
            ->with('driver')
            ->when(
                $request->filled('status'),
                fn ($query) => $query->where('status', $request->string('status')),
                fn ($query) => $query->open(),
            )
            ->orderBy('created_at')
            ->orderBy('id')
            ->cursorPaginate(25);

        return ApiResponse::success(
            DriverSettlementRequestResource::collection($paginator->getCollection()),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }

    public function confirm(Request $request, DriverSettlementRequest $settlementRequest): JsonResponse
    {
        $this->authorize('answer', $settlementRequest);

        /** @var User $user */
        $user = $request->user();

        $confirmed = $this->requests->confirm($settlementRequest, $user);

        // Idempotent by design: a request that was already answered comes back
        // unchanged rather than paying a second time, so a double-tap or a
        // retried request is safe. The status tells the caller which happened.
        return ApiResponse::success(
            new DriverSettlementRequestResource($confirmed),
            $confirmed->status === SettlementRequestStatus::CONFIRMED
                ? 'Settlement recorded.'
                : 'This request had already been answered.',
        );
    }

    public function decline(Request $request, DriverSettlementRequest $settlementRequest): JsonResponse
    {
        $this->authorize('answer', $settlementRequest);

        /** @var array{reason: string} $validated */
        $validated = $this->validateDecline($request);

        /** @var User $user */
        $user = $request->user();

        return ApiResponse::success(
            new DriverSettlementRequestResource(
                $this->requests->decline($settlementRequest, $user, $validated['reason']),
            ),
            'Request declined.',
        );
    }

    /**
     * A reason is required, not optional.
     *
     * This is the first surface on the platform where staff can refuse a
     * driver something about their own money, and "the office says no" with
     * no explanation is how a driver stops using a feature.
     *
     * @return array<string, string>
     */
    private function validateDecline(Request $request): array
    {
        /** @var array<string, string> $validated */
        $validated = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ]);

        return $validated;
    }
}
