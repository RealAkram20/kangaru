<?php

namespace Modules\Drivers\Controllers;

use App\Enums\AccessLevel;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\DriverWalkInContract;
use Modules\Drivers\Resources\WalkInContractResource;
use Modules\Drivers\Services\WalkInContractService;

/**
 * The office's half of a driver's walk-in contract (ADR-0055 §5, `K8`).
 *
 * Two queues behind one route, because they are the same list asked by
 * different parties: a **fleet** sees its own drivers waiting on its consent;
 * **head office** sees everything consented and waiting on them, oldest first.
 * Branched on the actor's level rather than split into two endpoints — it is
 * one question, *what is waiting on me*, and two URLs would let a fleet ask
 * head office's.
 */
class WalkInContractController extends Controller
{
    public function __construct(private readonly WalkInContractService $contracts) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', DriverWalkInContract::class);

        /** @var User $actor */
        $actor = $request->user();

        $query = DriverWalkInContract::query()->with(['driver', 'operator']);

        $contracts = $actor->access_level === AccessLevel::KANGARU
            ? $query->awaitingKangaru()->get()
            : $query->awaitingFleet((int) $actor->operator_id)->get();

        return ApiResponse::success(WalkInContractResource::collection($contracts));
    }

    /** The fleet consents. Its own driver only, and only before Kangaru answers. */
    public function consent(DriverWalkInContract $contract): JsonResponse
    {
        $this->authorize('consent', $contract);

        return ApiResponse::success(
            new WalkInContractResource($this->contracts->consent($contract)->load(['driver', 'operator'])),
            'Consent given. Kangaru decides next.',
        );
    }

    /**
     * Kangaru approves. The service refuses anything not already consented —
     * if this could be reached early, every driver would be contracted the
     * moment they asked and their fleet never consulted.
     */
    public function approve(DriverWalkInContract $contract): JsonResponse
    {
        $this->authorize('approve', $contract);

        return ApiResponse::success(
            new WalkInContractResource($this->contracts->approve($contract)->load(['driver', 'operator'])),
            'Driver accepted into walk-in work.',
        );
    }

    /** Whoever's turn it is says no. The service decides which answer it was. */
    public function refuse(Request $request, DriverWalkInContract $contract): JsonResponse
    {
        $this->authorize('refuse', $contract);

        $validated = $request->validate([
            // Optional: a fleet declining its own driver may have nothing to
            // say publicly. The driver is told the outcome either way
            // (ADR-0052), and an unexplained refusal they can see beats a
            // silent one they cannot.
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        return ApiResponse::success(
            new WalkInContractResource(
                $this->contracts->refuse($contract, $validated['reason'] ?? null)->load(['driver', 'operator']),
            ),
            'Request refused.',
        );
    }
}
