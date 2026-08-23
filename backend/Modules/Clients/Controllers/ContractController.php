<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Models\OperatorClient;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Resources\ContractResource;
use Modules\Clients\Services\ClientOnboardingService;

/**
 * The contracts between a fleet and a corporate client (ADR-0060).
 *
 * Three verbs, and each answers to a different party — which is the whole
 * shape of the decision:
 *
 * - a **fleet** asks (`store`), and gains nothing by asking;
 * - the **client** answers (`approve`), because the contract is theirs to
 *   grant — not Kangaru's, and not the incumbent fleet's;
 * - either side ends it (`destroy`), and the row survives because the trips
 *   and invoices it explains are still the client's history.
 */
class ContractController extends Controller
{
    public function __construct(private readonly ClientOnboardingService $onboarding) {}

    /**
     * What a client sees under *Our fleets*: who serves them, and who has
     * asked to.
     *
     * The one place a `requested` row is visible to anybody, and it is visible
     * to **the client alone** — they are the party being asked. The requesting
     * fleet is named, because a client cannot answer a request from somebody
     * anonymous; that disclosure is one-directional and it is the point.
     */
    public function index(Request $request): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();

        $this->authorize('viewAny', OperatorClient::class);

        $contracts = OperatorClient::query()
            ->with('operator')
            ->where('tenant_id', $actor->tenant_id)
            ->orderByRaw("FIELD(status, 'requested', 'active', 'ended')")
            ->get();

        return ApiResponse::success(ContractResource::collection($contracts));
    }

    /**
     * A fleet asks to serve a client already on Kangaru (ADR-0060 §4, path B).
     *
     * **Grants no read.** The response carries the request's own status and
     * nothing about the client — not their name, not their city, not whether
     * anybody else serves them. A fleet that asks learns exactly what it knew
     * before: that the number is taken.
     */
    public function store(Request $request): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();

        $this->authorize('create', OperatorClient::class);

        $validated = $request->validate([
            'registration_number' => ['required', 'string', 'max:100'],
        ]);

        $contract = $this->onboarding->requestContract(
            $validated['registration_number'],
            (int) $actor->operator_id,
        );

        return ApiResponse::success(
            ['status' => $contract->status],
            'Request sent. The client decides whether to accept it.',
            201,
        );
    }

    /**
     * The client accepts a fleet that asked (ADR-0060 §5).
     *
     * Gated on the policy, which checks the contract belongs to the caller's
     * own client — a corporate admin approving somebody else's contract is the
     * one thing this endpoint must never do.
     */
    public function approve(OperatorClient $contract): JsonResponse
    {
        $this->authorize('approve', $contract);

        return ApiResponse::success(
            new ContractResource($this->onboarding->approve($contract)->load('operator')),
            'Fleet accepted.',
        );
    }

    /** Ending a contract, from either side. The client keeps everything. */
    public function destroy(OperatorClient $contract): JsonResponse
    {
        $this->authorize('end', $contract);

        return ApiResponse::success(
            new ContractResource($this->onboarding->end($contract)->load('operator')),
            'Contract ended.',
        );
    }
}
