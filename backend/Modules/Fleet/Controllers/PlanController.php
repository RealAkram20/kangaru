<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Operator;
use App\Models\Plan;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Modules\Fleet\Resources\OperatorResource;
use Modules\Fleet\Resources\PlanResource;
use Modules\Fleet\Services\PlanAllowance;

/**
 * The plan catalogue, and moving a fleet between plans (ADR-0058).
 *
 * Reading is open to any signed-in account: a fleet is entitled to know what
 * it could move to, and the catalogue carries no other fleet's information.
 * **Changing which plan a fleet is on is head office's**, because it is
 * Kangaru's commercial relationship with that fleet and not the fleet's own
 * to edit.
 */
class PlanController extends Controller
{
    public function __construct(private readonly PlanAllowance $allowance) {}

    public function index(): JsonResponse
    {
        return ApiResponse::success(
            PlanResource::collection(
                Plan::query()->withCount('operators')->orderBy('price_minor')->orderBy('name')->get(),
            ),
        );
    }

    /**
     * Move a fleet onto a plan.
     *
     * ADR-0058 §4's third prohibition, and the only place it can be enforced:
     * **a move to a plan smaller than the fleet's current usage is refused,
     * and the refusal names the figures.** The office reduces first. The
     * alternative is a switch that quietly takes twenty-eight drivers out of
     * service, on a day nobody would connect to a plan change made in a
     * different screen.
     */
    public function assign(Request $request, Operator $operator): JsonResponse
    {
        Gate::authorize('update', $operator);

        $validated = $request->validate([
            'plan_id' => ['required', 'integer', 'exists:plans,id'],
        ]);

        /** @var Plan $plan `findOrFail` is typed as model-or-collection; the id is a scalar. */
        $plan = Plan::query()->findOrFail($validated['plan_id']);
        $blockers = $this->allowance->blockers($operator, $plan);

        if ($blockers !== []) {
            throw ValidationException::withMessages([
                'plan_id' => array_map(
                    fn (string $resource, array $figures) => sprintf(
                        '%s allows %d %s, and this fleet has %d.',
                        $plan->name,
                        $figures['limit'],
                        $resource,
                        $figures['current'],
                    ),
                    array_keys($blockers),
                    $blockers,
                ),
            ]);
        }

        $operator->update(['plan_id' => $plan->id]);

        // `fresh()` is typed nullable — it re-reads from the database and the
        // row could in principle have gone. It cannot have here: the update
        // above just succeeded on it inside this request.
        $operator->refresh()->load('plan');

        return ApiResponse::success(new OperatorResource($operator), 'Plan changed.');
    }
}
