<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Operator;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Fleet\Requests\StoreOperatorRequest;
use Modules\Fleet\Requests\UpdateOperatorRequest;
use Modules\Fleet\Resources\OperatorResource;
use Modules\Fleet\Services\OperatorService;

/**
 * The register of fleet companies — head office's only one (ADR-0059).
 *
 * This is blocker number one in `docs/fleet-model-plan.md` §4b: *"No way to
 * create an operator. No endpoint, no screen, no seeder."* Until this
 * existed, a second fleet could not exist, and the whole of ADR-0055 was
 * theoretical.
 *
 * Every method is `kangaru`-level only — see `OperatorPolicy`, which explains
 * why the level rather than the permission is what holds that line.
 */
class OperatorController extends Controller
{
    public function __construct(private readonly OperatorService $operators) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Operator::class);

        $operators = Operator::query()
            ->with('plan')
            // Counted once for the page rather than per row. These four are
            // the point of the register — a name and a slug tell you nothing
            // about whether a fleet is running — and four `whenCounted`
            // fields with no `withCount` would silently render nothing.
            ->withCount(['users', 'drivers', 'vehicles', 'contracts as clients_count'])
            ->orderBy('name')
            ->get();

        return ApiResponse::success(OperatorResource::collection($operators));
    }

    public function show(Operator $operator): JsonResponse
    {
        $this->authorize('view', $operator);

        $operator->load('plan')
            ->loadCount(['users', 'drivers', 'vehicles', 'contracts as clients_count']);

        return ApiResponse::success(new OperatorResource($operator));
    }

    /**
     * The fleet and its first account, together or not at all (ADR-0059 §5).
     */
    public function store(StoreOperatorRequest $request): JsonResponse
    {
        $this->authorize('create', Operator::class);

        /** @var array{name: string, slug?: string|null, owner_name: string, owner_email: string} $input */
        $input = $request->validated();

        $operator = $this->operators->onboard($input, $request->user());

        $operator->load('plan')
            ->loadCount(['users', 'drivers', 'vehicles', 'contracts as clients_count']);

        return ApiResponse::success(
            new OperatorResource($operator),
            // Was "can be invited", which was aspirational: nothing sent an
            // invitation and the owner could not sign in at all.
            'Fleet onboarded. Its owner has been emailed an invitation.',
            201,
        );
    }

    public function update(UpdateOperatorRequest $request, Operator $operator): JsonResponse
    {
        $this->authorize('update', $operator);

        $operator->update($request->validated());

        $operator->refresh()
            ->load('plan')
            ->loadCount(['users', 'drivers', 'vehicles', 'contracts as clients_count']);

        return ApiResponse::success(new OperatorResource($operator), 'Fleet updated.');
    }
}
